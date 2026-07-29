import { FilterQuery, Types } from "mongoose";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";
import { LeaveTypeModel, LeaveTypeDoc } from "../models/leaveTypeModel";
import { UserModel } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { UserRole } from "../enums/UserEnum";
import {
  isProbationApplicable,
  leaveStartMonthForYear,
  eligibleMonthsInYear,
} from "../utils/probation";

// Super-admins are not employees on the books — they don't accrue or
// consume leave. Used everywhere a user list feeds the leave-balance
// system so we never seed / reset / sum a balance row for them.
const NOT_SUPER_ADMIN_FILTER = {
  role: { $ne: UserRole.SuperAdmin },
};

interface DeductArgs {
  userId: string | Types.ObjectId;
  leaveTypeId: string | Types.ObjectId;
  year: number;
  days: number;
}

function oid(id: string | Types.ObjectId) {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

export async function getBalance(
  userId: string | Types.ObjectId,
  year: number,
  leaveTypeId: string | Types.ObjectId,
) {
  return LeaveBalanceModel.findOne({
    user: oid(userId),
    year,
    leaveType: oid(leaveTypeId),
  });
}

// Atomically add `days` to the `used` counter. Returns the updated doc so
// callers can surface the new remaining balance. Does NOT gate on allocation
// — the caller decides what happens when usage exceeds allocation.
export async function incrementUsed({ userId, leaveTypeId, year, days }: DeductArgs) {
  const updated = await LeaveBalanceModel.findOneAndUpdate(
    { user: oid(userId), year, leaveType: oid(leaveTypeId) },
    { $inc: { used: days }, $setOnInsert: { allocated: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return updated;
}

export async function decrementUsed({ userId, leaveTypeId, year, days }: DeductArgs) {
  // Floor at 0: we never want to show a negative used count.
  const doc = await LeaveBalanceModel.findOne({
    user: oid(userId),
    year,
    leaveType: oid(leaveTypeId),
  });
  if (!doc) return null;
  doc.used = Math.max(0, doc.used - days);
  await doc.save();
  return doc;
}

export async function listBalancesForUser(userId: string | Types.ObjectId, year: number) {
  return LeaveBalanceModel.find({ user: oid(userId), year })
    .populate("leaveType")
    .lean();
}

/**
 * Compute how many days a user can still avail in a given month for a
 * specific leave type, after applying the monthly quota and carry-forward.
 *
 * Formula:
 *   effectiveQuota = balance.monthlyQuota               (per-user override)
 *                 ?? type.monthlyQuota                  (type default, e.g. PL = 1/mo)
 *                 ?? null                               (uncapped — ML / UL)
 *   startMonth     = balance.leaveStartMonth ?? 1       (probation re-anchor)
 *   monthsAccrued  = max(0, month - startMonth + 1)     (count from start)
 *   monthlyCeiling = min(monthsAccrued * effectiveQuota, allocated)
 *   available      = max(monthlyCeiling - used, 0)
 *
 * Per-user override on `LeaveBalance.monthlyQuota` always wins — admin
 * can tune individual employees (`0` disables accrual; any number sets
 * a custom rate) without touching the type for everyone else.
 *
 * `leaveStartMonth` is set on the balance row for probationary new
 * joiners — e.g. an April joiner gets `leaveStartMonth = 7`, so July
 * is treated as month #1 of accrual (1 day available), August as #2
 * (2 days), etc. Legacy / full-year employees leave it at 1 (or null,
 * which the formula treats as 1) so behaviour is unchanged.
 *
 * `null`/undefined `monthlyQuota` (on either) means "no monthly cap" —
 * the full remaining annual balance is available (ML, UL).
 */
export function computeMonthlyAvailable(
  type: Pick<LeaveTypeDoc, "monthlyQuota" | "isUnpaidBucket">,
  balance:
    | {
        allocated: number;
        used: number;
        monthlyQuota?: number | null;
        leaveStartMonth?: number | null;
      }
    | null,
  month: number, // 1–12
): number {
  const allocated = balance?.allocated ?? 0;
  const used = balance?.used ?? 0;

  // UL → no monthly cap, expose remaining annual.
  if (type.isUnpaidBucket) {
    return Math.max(allocated - used, 0);
  }

  // Effective monthly quota:
  //   - per-user override wins (numeric 0 = no accrual; any number = rate)
  //   - else fall back to the LeaveType's global default (e.g. PL = 1/mo)
  //   - null on both means uncapped (ML)
  const effectiveQuota =
    balance?.monthlyQuota != null ? balance.monthlyQuota : type.monthlyQuota;

  if (effectiveQuota == null) {
    return Math.max(allocated - used, 0);
  }

  // Re-anchor the ceiling so probationary joiners don't unlock the
  // entire allocation on day 1 of their leave-eligible month.
  const startMonth = balance?.leaveStartMonth ?? 1;
  const monthsAccrued = Math.max(0, month - startMonth + 1);
  const monthlyCeiling = Math.min(monthsAccrued * effectiveQuota, allocated);
  return Math.max(monthlyCeiling - used, 0);
}

/**
 * "This month only" remaining accrual for the current calendar month.
 *
 * Unlike {@link computeMonthlyAvailable} — which surfaces the *paid pool*
 * (cumulative accrual − used, capped at yearly) — this helper surfaces
 * only the fresh monthly slice that hasn't been consumed yet in the
 * current month. It's what the UI shows as "Available this month" so
 * the employee/admin sees the accurate current-month figure instead of
 * the confusing carry-forward stack.
 *
 * Formula (for monthly-capped types):
 *   remaining = max(0, effectiveQuota − usedThisMonth)
 *
 * Types with no monthly cap (UL / uncapped ML) return the same
 * `allocated − used` as `computeMonthlyAvailable`; nothing to slice.
 */
export function computeRemainingThisMonth(
  type: Pick<LeaveTypeDoc, "monthlyQuota" | "isUnpaidBucket">,
  balance:
    | {
        allocated: number;
        used: number;
        monthlyQuota?: number | null;
      }
    | null,
  usedThisMonth: number,
): number {
  const allocated = balance?.allocated ?? 0;
  const used = balance?.used ?? 0;
  if (type.isUnpaidBucket) return Math.max(allocated - used, 0);
  const effective =
    balance?.monthlyQuota != null ? balance.monthlyQuota : type.monthlyQuota;
  if (effective == null) return Math.max(allocated - used, 0);
  return Math.max(effective - usedThisMonth, 0);
}

/**
 * Pure helper that returns the same effective monthly quota
 * `computeMonthlyAvailable` uses internally. Exported so the controller
 * can surface it on the listing response (so the admin UI shows what
 * each employee accrues per month at a glance).
 */
export function effectiveMonthlyQuota(
  type: Pick<LeaveTypeDoc, "monthlyQuota" | "isUnpaidBucket">,
  balance: { allocated: number; monthlyQuota?: number | null } | null,
): number | null {
  if (type.isUnpaidBucket) return null;
  if (balance?.monthlyQuota != null) return balance.monthlyQuota;
  return type.monthlyQuota ?? null;
}

/**
 * Given a requested leave-type + day count + month, return the split that
 * should be recorded on the leave (an array of {leaveType, days} entries).
 *
 * Rules:
 *  - UL / no-monthly-quota types → no split; everything stays on the
 *    requested type.
 *  - Monthly-capped types → take up to `monthlyAvailable` from the requested
 *    type; the overflow moves to the unpaid bucket (UL).
 *  - If there is no UL configured at all, all overflow stays on the
 *    requested type (matches the legacy behavior).
 */
export async function computeLeaveSplit(args: {
  userId: string | Types.ObjectId;
  leaveTypeId: string | Types.ObjectId;
  year: number;
  month: number;
  requestedDays: number;
}): Promise<{
  type: LeaveTypeDoc;
  monthlyAvailable: number;
  split: Array<{ leaveType: Types.ObjectId; days: number }>;
}> {
  const type = await LeaveTypeModel.findById(args.leaveTypeId).lean<LeaveTypeDoc>();
  if (!type) throw new Error("Leave type not found");

  const balance = await LeaveBalanceModel.findOne({
    user: oid(args.userId),
    year: args.year,
    leaveType: oid(args.leaveTypeId),
  }).lean();

  const monthlyAvailable = computeMonthlyAvailable(
    type,
    balance
      ? {
          allocated: balance.allocated,
          used: balance.used,
          monthlyQuota: balance.monthlyQuota,
          leaveStartMonth: balance.leaveStartMonth,
        }
      : null,
    args.month,
  );

  // Reuse the shared helper so split logic and ceiling logic agree on
  // what the effective quota is. `null` means uncapped — never splits.
  const effective = effectiveMonthlyQuota(
    type,
    balance ? { allocated: balance.allocated, monthlyQuota: balance.monthlyQuota } : null,
  );

  // UL or uncapped → never splits.
  if (type.isUnpaidBucket || effective == null) {
    return {
      type,
      monthlyAvailable,
      split: [{ leaveType: type._id as Types.ObjectId, days: args.requestedDays }],
    };
  }

  if (args.requestedDays <= monthlyAvailable) {
    return {
      type,
      monthlyAvailable,
      split: [{ leaveType: type._id as Types.ObjectId, days: args.requestedDays }],
    };
  }

  // Overflow — put the remainder on the UL bucket if one exists.
  const unpaid = await LeaveTypeModel.findOne({ isUnpaidBucket: true }).lean<LeaveTypeDoc>();
  const primaryDays = Math.max(monthlyAvailable, 0);
  const overflow = args.requestedDays - primaryDays;

  if (!unpaid) {
    return {
      type,
      monthlyAvailable,
      split: [{ leaveType: type._id as Types.ObjectId, days: args.requestedDays }],
    };
  }

  const split: Array<{ leaveType: Types.ObjectId; days: number }> = [];
  if (primaryDays > 0) split.push({ leaveType: type._id as Types.ObjectId, days: primaryDays });
  split.push({ leaveType: unpaid._id as Types.ObjectId, days: overflow });
  return { type, monthlyAvailable, split };
}

export async function listBalancesForYear(year: number) {
  // Exclude balances belonging to inactive employees or super-admins. We
  // do the exclusion via a `userRef ∉ hiddenIds` filter because
  // `LeaveBalanceModel` doesn't natively carry the user's active flag,
  // and we don't want to filter post-populate (would still ship all rows
  // over the wire).
  const hiddenUserIds = await UserModel.distinct("_id", {
    $or: [{ role: UserRole.SuperAdmin }, { active: false }],
  });
  return LeaveBalanceModel.find({
    year,
    user: { $nin: hiddenUserIds },
  })
    .populate("leaveType")
    .populate("user", "firstName lastName email active")
    .lean();
}

/**
 * Upsert a user's allocation for a (year, leaveType). When `monthlyQuota`
 * is supplied as a number, it overrides the LeaveType's global quota for
 * this row. Pass `null` to *clear* the override and revert to the global
 * default. `undefined` (not in the patch) leaves the existing override
 * untouched.
 *
 * Used for mid-year joiners — admin sets a prorated `allocated` AND a
 * lower `monthlyQuota` so the cumulative ceiling doesn't unlock the full
 * balance immediately on the first eligible month.
 */
export async function setAllocation(
  userId: string | Types.ObjectId,
  year: number,
  leaveTypeId: string | Types.ObjectId,
  allocated: number,
  options: { monthlyQuota?: number | null } = {},
) {
  const update: Record<string, unknown> = {
    allocated: Math.max(0, allocated),
  };
  if (options.monthlyQuota === null) {
    update.monthlyQuota = null;
  } else if (typeof options.monthlyQuota === "number") {
    update.monthlyQuota = Math.max(0, options.monthlyQuota);
  }
  return LeaveBalanceModel.findOneAndUpdate(
    { user: oid(userId), year, leaveType: oid(leaveTypeId) },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * For a user with a given date of joining (DOJ) and a target year, return a
 * 0..1 multiplier to apply to each leave type's `defaultAllocationPerYear`.
 *
 *  - DOJ <= Jan 1 of the year          → 1.0  (full allocation)
 *  - DOJ in the target year            → (12 - joinMonth) / 12
 *                                         (inclusive of the join month, so
 *                                         someone joining in July gets 6/12)
 *  - DOJ > Dec 31 of the year          → 0.0
 *  - DOJ unknown / missing             → 1.0  (safe default — full allocation)
 *
 * Rounded to the nearest 0.5 so totals read cleanly on the UI.
 */
export function prorataMultiplier(
  dateOfJoining: Date | string | undefined | null,
  year: number,
): number {
  if (!dateOfJoining) return 1;
  const doj = new Date(dateOfJoining);
  if (Number.isNaN(doj.getTime())) return 1;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  if (doj.getTime() < yearStart.getTime()) return 1;
  if (doj.getTime() > yearEnd.getTime()) return 0;
  const joinMonth = doj.getUTCMonth(); // 0-indexed
  const remainingMonths = 12 - joinMonth;
  return remainingMonths / 12;
}

/**
 * Probation context bundled per-user, fetched alongside DOJ. Carrying
 * these three fields lets `computeAllocationForType` decide without
 * touching the DB again.
 */
interface UserProbationCtx {
  dateOfJoining?: Date | null;
  probationStatus?: "in_progress" | "confirmed" | null;
  probationEndDate?: Date | null;
}

/**
 * Compute the per-type allocation, monthly quota, and start-month for
 * one (user, year, leaveType) row given the user's DOJ + probation
 * status. The three branches are mutually exclusive:
 *
 *  A. UL / unpaid bucket  → allocated 0 always.
 *
 *  B. probationStatus = 'in_progress'
 *     → allocated 0, monthlyQuota = type rate (locked for when status
 *       flips to confirmed and a re-seed runs), leaveStartMonth = 13
 *       (sentinel = nothing accrues this year). No paid leaves credit
 *       until an admin confirms via the EmployeeManagement page.
 *
 *  C. probationStatus = 'confirmed'
 *     → use probationEndDate's calendar month as the leave-start anchor.
 *       Backdating credits retroactively (admin saw it late) — e.g.
 *       endDate = May 23 → leaveStartMonth = 5 → May–Dec eligible →
 *       8 × monthlyRate. Forward-dating also works.
 *
 *  D. Legacy / pre-feature-launch DOJ (or no DOJ)
 *     → unchanged: allocated = type.defaultAllocationPerYear ×
 *       prorataMultiplier(DOJ, year); leaveStartMonth = 1.
 *
 * The implicit-probation path (post-launch DOJ but no explicit status)
 * is folded into 'in_progress' — once the admin-driven workflow is
 * live, every new joiner gets a status set at activation, so this case
 * should only show up for the brief window during the migration.
 */
function computeAllocationForType(
  type: Pick<
    LeaveTypeDoc,
    "defaultAllocationPerYear" | "monthlyQuota" | "isUnpaidBucket"
  >,
  ctx: UserProbationCtx,
  year: number,
): { allocated: number; monthlyQuota: number | null; leaveStartMonth: number } {
  // ── A. UL / unpaid bucket ─────────────────────────────────────────
  if (type.isUnpaidBucket) {
    return { allocated: 0, monthlyQuota: null, leaveStartMonth: 1 };
  }

  const monthlyRate = type.monthlyQuota ?? 1;

  // ── B. Probation in progress ──────────────────────────────────────
  // No paid leaves credit until admin confirms. We lock the monthly
  // rate so future re-seeds (post-confirmation) don't drift to type
  // default, but allocated stays 0 and leaveStartMonth = 13 so the
  // available-this-month formula returns 0.
  const treatAsInProgress =
    ctx.probationStatus === "in_progress" ||
    (!ctx.probationStatus &&
      isProbationApplicable(ctx.dateOfJoining ?? undefined));
  if (treatAsInProgress) {
    return {
      allocated: 0,
      monthlyQuota: monthlyRate,
      leaveStartMonth: 13,
    };
  }

  // ── C. Probation confirmed ────────────────────────────────────────
  // Use the admin-chosen probationEndDate's calendar month as the
  // leave-start anchor. Allow backdating (full credit from past month
  // onwards) and forward-dating.
  if (ctx.probationStatus === "confirmed" && ctx.probationEndDate) {
    const end = new Date(ctx.probationEndDate);
    const endYear = end.getFullYear();
    if (endYear > year) {
      // Future-confirmed but next year — nothing this year.
      return { allocated: 0, monthlyQuota: monthlyRate, leaveStartMonth: 13 };
    }
    const startMonth = endYear < year ? 1 : end.getMonth() + 1;
    const eligible = Math.max(0, 12 - startMonth + 1);
    const allocated = roundHalf(eligible * monthlyRate);
    return {
      allocated,
      monthlyQuota: monthlyRate,
      leaveStartMonth: startMonth,
    };
  }

  // ── D. Legacy / pre-launch joiner: unchanged behaviour ────────────
  const base = type.defaultAllocationPerYear || 0;
  const allocated =
    base > 0
      ? roundHalf(base * prorataMultiplier(ctx.dateOfJoining ?? undefined, year))
      : 0;
  return { allocated, monthlyQuota: null, leaveStartMonth: 1 };
}

/** Round to nearest 0.5 so allocations read cleanly (e.g. 5.5, not 5.833). */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

async function probationCtxMapForUsers(
  userIds: Types.ObjectId[],
): Promise<Map<string, UserProbationCtx>> {
  if (!userIds.length) return new Map();
  // UserProfileModel declares `user` as Schema.Types.ObjectId (constructor
  // type, not instance). Strict TS rejects the $in filter with Types.ObjectId
  // instances. Cast to FilterQuery<Record<string,unknown>> to bypass —
  // Mongoose itself accepts both at runtime.
  const filter = { user: { $in: userIds } } as FilterQuery<Record<string, unknown>>;
  const profiles = await UserProfileModel.find(filter)
    .select("user dateOfJoining probationStatus probationEndDate")
    .lean();
  const map = new Map<string, UserProbationCtx>();
  for (const p of profiles as Array<{
    user: unknown;
    dateOfJoining?: Date;
    probationStatus?: "in_progress" | "confirmed";
    probationEndDate?: Date;
  }>) {
    map.set(String(p.user), {
      dateOfJoining: p.dateOfJoining,
      probationStatus: p.probationStatus,
      probationEndDate: p.probationEndDate,
    });
  }
  return map;
}

/**
 * Reset/seed balances for `year`. Each user's allocation is prorated based
 * on their `UserProfile.dateOfJoining` — new mid-year joiners get a fraction
 * of each leave type's default, existing employees get full allocation.
 *
 * Idempotent: upserts with `$setOnInsert` by default so already-existing
 * balances are untouched. `force: true` overwrites `allocated` + `used`
 * (used by the Jan 1 scheduler).
 */
export async function resetBalancesForYear(year: number, opts: { force?: boolean } = {}) {
  const [users, types] = await Promise.all([
    UserModel.find({ active: true, ...NOT_SUPER_ADMIN_FILTER })
      .select("_id")
      .lean(),
    LeaveTypeModel.find({ active: true }).lean(),
  ]);

  if (!users.length || !types.length) {
    return { year, users: users.length, types: types.length, upserted: 0 };
  }

  const ctxMap = await probationCtxMapForUsers(
    users.map((u) => u._id as Types.ObjectId),
  );

  const ops = [];
  for (const u of users) {
    const ctx = ctxMap.get(String(u._id)) ?? {};
    for (const t of types) {
      const { allocated, monthlyQuota, leaveStartMonth } =
        computeAllocationForType(t, ctx, year);
      const insertDoc = {
        user: u._id,
        year,
        leaveType: t._id,
        allocated,
        used: 0,
        // Always include monthlyQuota + leaveStartMonth on the row so
        // probationary balances re-anchor correctly. For legacy
        // employees both fall back to defaults (null / 1).
        monthlyQuota,
        leaveStartMonth,
      };
      const payload = opts.force
        ? { $set: insertDoc }
        : { $setOnInsert: insertDoc };
      ops.push({
        updateOne: {
          filter: { user: u._id, year, leaveType: t._id },
          update: payload,
          upsert: true,
        },
      });
    }
  }

  const result = await LeaveBalanceModel.bulkWrite(ops);
  return {
    year,
    users: users.length,
    types: types.length,
    upserted: (result.upsertedCount || 0) + (result.modifiedCount || 0),
  };
}

/**
 * Seed balances for a single user across all active leave types for the
 * given year, applying prorata + probation based on their DOJ. Used on:
 *   - User activation (`opts.force = false`): inserts rows only if
 *     they don't already exist. Safe for the common case where the
 *     user is being onboarded for the first time.
 *   - Profile creation (`opts.force = true`): OVERWRITES existing
 *     rows. Necessary because the activation hook may have created
 *     rows on the legacy path (no DOJ → multiplier=1, no probation)
 *     before the profile existed; this re-run with the now-known DOJ
 *     fixes those rows to honour probation.
 *
 * `used` is preserved across force re-seeds so we don't undo any leave
 * already taken by the user — only `allocated`, `monthlyQuota`, and
 * `leaveStartMonth` get rewritten.
 */
export async function seedBalancesForUser(
  userId: string | Types.ObjectId,
  year: number,
  opts: { force?: boolean } = {},
) {
  // Skip super-admins entirely — they don't accrue or consume leave.
  // Skip inactive users too — they're off-boarded, so seeding new balance
  // rows for them would re-surface them in HR dashboards. Without these
  // guards, activating a super-admin or seeding for a terminated employee
  // would create empty balance rows that then show up in admin dashboards.
  const userDoc = await UserModel.findOne({
    _id: oid(userId),
    active: true,
    ...NOT_SUPER_ADMIN_FILTER,
  })
    .select("_id")
    .lean();
  if (!userDoc) return { userId: String(userId), upserted: 0 };

  const profileFilter = { user: oid(userId) } as FilterQuery<Record<string, unknown>>;
  const [types, profile] = await Promise.all([
    LeaveTypeModel.find({ active: true }).lean(),
    UserProfileModel.findOne(profileFilter)
      .select("dateOfJoining probationStatus probationEndDate")
      .lean(),
  ]);

  if (!types.length) return { userId: String(userId), upserted: 0 };

  const p = profile as {
    dateOfJoining?: Date;
    probationStatus?: "in_progress" | "confirmed";
    probationEndDate?: Date;
  } | null;
  const ctx: UserProbationCtx = {
    dateOfJoining: p?.dateOfJoining,
    probationStatus: p?.probationStatus,
    probationEndDate: p?.probationEndDate,
  };
  const multiplier = prorataMultiplier(ctx.dateOfJoining ?? undefined, year);

  const ops = types.map((t) => {
    const { allocated, monthlyQuota, leaveStartMonth } =
      computeAllocationForType(t, ctx, year);
    const insertOnly = {
      user: oid(userId),
      year,
      leaveType: t._id,
      allocated,
      used: 0,
      monthlyQuota,
      leaveStartMonth,
    };
    // Force mode: $set the allocation fields onto existing rows too,
    // but DON'T reset `used` — we'd erase already-taken leaves.
    // $setOnInsert handles the brand-new row case.
    const forcedUpdate = {
      $set: {
        allocated,
        monthlyQuota,
        leaveStartMonth,
      },
      $setOnInsert: {
        user: oid(userId),
        year,
        leaveType: t._id,
        used: 0,
      },
    };
    return {
      updateOne: {
        filter: { user: oid(userId), year, leaveType: t._id },
        update: opts.force ? forcedUpdate : { $setOnInsert: insertOnly },
        upsert: true,
      },
    };
  });

  const result = await LeaveBalanceModel.bulkWrite(ops);
  return {
    userId: String(userId),
    year,
    multiplier,
    upserted: (result.upsertedCount || 0) + (result.modifiedCount || 0),
  };
}
