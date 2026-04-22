import { FilterQuery, Types } from "mongoose";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";
import { LeaveTypeModel, LeaveTypeDoc } from "../models/leaveTypeModel";
import { UserModel } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";

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
 *   monthlyCeiling = min(month * monthlyQuota, allocated)
 *   available      = max(monthlyCeiling - used, 0)
 *
 * A null/undefined monthlyQuota means "no monthly restriction" — the full
 * remaining annual balance is available (used for UL and ML).
 */
export function computeMonthlyAvailable(
  type: Pick<LeaveTypeDoc, "monthlyQuota" | "isUnpaidBucket">,
  balance: { allocated: number; used: number } | null,
  month: number, // 1–12
): number {
  const allocated = balance?.allocated ?? 0;
  const used = balance?.used ?? 0;

  // UL / types without a monthly cap — just expose remaining annual.
  if (type.isUnpaidBucket || type.monthlyQuota == null) {
    return Math.max(allocated - used, 0);
  }

  const monthlyCeiling = Math.min(month * type.monthlyQuota, allocated);
  return Math.max(monthlyCeiling - used, 0);
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
    balance ? { allocated: balance.allocated, used: balance.used } : null,
    args.month,
  );

  // UL or no monthly cap → never splits.
  if (type.isUnpaidBucket || type.monthlyQuota == null) {
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
  return LeaveBalanceModel.find({ year })
    .populate("leaveType")
    .populate("user", "firstName lastName email active")
    .lean();
}

export async function setAllocation(
  userId: string | Types.ObjectId,
  year: number,
  leaveTypeId: string | Types.ObjectId,
  allocated: number,
) {
  return LeaveBalanceModel.findOneAndUpdate(
    { user: oid(userId), year, leaveType: oid(leaveTypeId) },
    { $set: { allocated: Math.max(0, allocated) } },
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

/** Round to nearest 0.5 so allocations read cleanly (e.g. 5.5, not 5.833). */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

async function doJMapForUsers(userIds: Types.ObjectId[]): Promise<Map<string, Date | undefined>> {
  if (!userIds.length) return new Map();
  // UserProfileModel declares `user` as Schema.Types.ObjectId (constructor
  // type, not instance). Strict TS rejects the $in filter with Types.ObjectId
  // instances. Cast to FilterQuery<Record<string,unknown>> to bypass —
  // Mongoose itself accepts both at runtime.
  const filter = { user: { $in: userIds } } as FilterQuery<Record<string, unknown>>;
  const profiles = await UserProfileModel.find(filter)
    .select("user dateOfJoining")
    .lean();
  const map = new Map<string, Date | undefined>();
  for (const p of profiles as Array<{ user: unknown; dateOfJoining?: Date }>) {
    map.set(String(p.user), p.dateOfJoining);
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
    UserModel.find({ active: true }).select("_id").lean(),
    LeaveTypeModel.find({ active: true }).lean(),
  ]);

  if (!users.length || !types.length) {
    return { year, users: users.length, types: types.length, upserted: 0 };
  }

  const dojMap = await doJMapForUsers(users.map((u) => u._id as Types.ObjectId));

  const ops = [];
  for (const u of users) {
    const multiplier = prorataMultiplier(dojMap.get(String(u._id)), year);
    for (const t of types) {
      // UL / uncapped types with defaultAllocationPerYear == 0 are untouched
      // by prorata (still 0). Only positive defaults get the fraction.
      const base = t.defaultAllocationPerYear || 0;
      const allocated = base > 0 ? roundHalf(base * multiplier) : 0;
      const payload = opts.force
        ? {
            $set: {
              user: u._id,
              year,
              leaveType: t._id,
              allocated,
              used: 0,
            },
          }
        : {
            $setOnInsert: {
              user: u._id,
              year,
              leaveType: t._id,
              allocated,
              used: 0,
            },
          };
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
 * given year, applying prorata based on their DOJ. Used on activation of
 * a new user so they get balances the first time they log in. Won't
 * overwrite an existing balance row (uses $setOnInsert).
 */
export async function seedBalancesForUser(
  userId: string | Types.ObjectId,
  year: number,
) {
  const profileFilter = { user: oid(userId) } as FilterQuery<Record<string, unknown>>;
  const [types, profile] = await Promise.all([
    LeaveTypeModel.find({ active: true }).lean(),
    UserProfileModel.findOne(profileFilter).select("dateOfJoining").lean(),
  ]);

  if (!types.length) return { userId: String(userId), upserted: 0 };

  const doj = (profile as { dateOfJoining?: Date } | null)?.dateOfJoining;
  const multiplier = prorataMultiplier(doj, year);

  const ops = types.map((t) => {
    const base = t.defaultAllocationPerYear || 0;
    const allocated = base > 0 ? roundHalf(base * multiplier) : 0;
    return {
      updateOne: {
        filter: { user: oid(userId), year, leaveType: t._id },
        update: {
          $setOnInsert: {
            user: oid(userId),
            year,
            leaveType: t._id,
            allocated,
            used: 0,
          },
        },
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
