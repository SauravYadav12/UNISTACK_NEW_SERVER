import { Request, Response } from "express";
import { Types } from "mongoose";
import { UserDoc } from "../interface";
import {
  listBalancesForUser,
  listBalancesForYear,
  setAllocation,
  resetBalancesForYear,
  computeMonthlyAvailable,
  computeRemainingThisMonth,
  effectiveMonthlyQuota,
  seedBalancesForUser,
} from "../services/leaveBalanceService";
import { LeaveTypeDoc } from "../models/leaveTypeModel";
import { LeaveModel, LeaveStatus } from "../models/leaveModel";

/**
 * Build a map keyed by `${userId}:${leaveTypeId}` → days used in the
 * given calendar month, summed across every splitBreakdown row from
 * approved leaves whose START DATE falls in the month. Used to compute
 * the "remaining this month" display.
 */
async function buildUsedThisMonthMap(
  userIds: Types.ObjectId[],
  year: number,
  month: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const leaves = await LeaveModel.find({
    userRef: { $in: userIds },
    status: LeaveStatus.Approved,
    startDate: { $gte: start, $lt: end },
  } as Record<string, unknown>)
    .select("userRef leaveType splitBreakdown")
    .lean();
  for (const lv of leaves as unknown as Array<{
    userRef: Types.ObjectId;
    leaveType?: Types.ObjectId;
    splitBreakdown?: Array<{ leaveType: Types.ObjectId; days: number }>;
  }>) {
    const uid = String(lv.userRef);
    // Prefer splitBreakdown; fall back to the parent leaveType if a
    // legacy row didn't get one (whole thing lands on that type).
    const rows = Array.isArray(lv.splitBreakdown) && lv.splitBreakdown.length
      ? lv.splitBreakdown
      : lv.leaveType
        ? [{ leaveType: lv.leaveType, days: 0 }]
        : [];
    for (const row of rows) {
      if (!row.leaveType || typeof row.days !== "number") continue;
      const key = `${uid}:${String(row.leaveType)}`;
      out.set(key, (out.get(key) || 0) + row.days);
    }
  }
  return out;
}

function yearOf(req: Request) {
  return Number(req.params.year || req.query.year || new Date().getFullYear());
}

function monthOf(req: Request) {
  const raw = req.query.month;
  const m = Number(Array.isArray(raw) ? raw[0] : raw);
  if (m >= 1 && m <= 12) return m;
  return new Date().getMonth() + 1;
}

function str(v: unknown): string {
  return Array.isArray(v) ? String(v[0]) : String(v);
}

// Decorate each balance row with `monthlyAvailable` so the client doesn't
// have to re-derive the quota math. The lean-populated balance has
// leaveType expanded to the full doc; we read monthlyQuota / isUnpaidBucket
// off that. We also pass through the row's own `monthlyQuota` override
// AND `leaveStartMonth` so probationary employees correctly show 0
// available before their leave-start month.
async function withMonthlyAvailable<
  T extends {
    leaveType: unknown;
    user?: unknown;
    userRef?: unknown;
    allocated: number;
    used: number;
    monthlyQuota?: number | null;
    leaveStartMonth?: number | null;
  }
>(rows: T[], year: number, month: number) {
  // Collect the userIds present in the listing so we can build the
  // "used this month" aggregate with one query instead of one per row.
  const userIds = Array.from(
    new Set(
      rows
        .map((r) => r.user ?? r.userRef)
        .filter((v): v is Types.ObjectId | string => !!v)
        .map((v) =>
          typeof v === "string"
            ? Types.ObjectId.isValid(v)
              ? new Types.ObjectId(v)
              : null
            : (v as Types.ObjectId),
        )
        .filter((v): v is Types.ObjectId => !!v),
    ),
  );
  const usedThisMonthMap = await buildUsedThisMonthMap(userIds, year, month);

  return rows.map((b) => {
    const t = b.leaveType as LeaveTypeDoc | null | undefined;
    const monthlyAvailable = t
      ? computeMonthlyAvailable(
          t,
          {
            allocated: b.allocated,
            used: b.used,
            monthlyQuota: b.monthlyQuota,
            // Critical for probationary employees: without this,
            // `computeMonthlyAvailable` falls back to startMonth=1 and
            // exposes the full annual allocation in the very first
            // calendar month.
            leaveStartMonth: b.leaveStartMonth,
          },
          month,
        )
      : Math.max(b.allocated - b.used, 0);
    // Effective per-month quota — the rate this user accrues at, after
    // resolving (per-user override → uncapped check → allocated/12 default).
    // Null means uncapped (UL / ML when not overridden). Surfaced here so
    // the admin UI can show "what does this user actually get per month"
    // without re-deriving the math client-side.
    const effective = t
      ? effectiveMonthlyQuota(t, {
          allocated: b.allocated,
          monthlyQuota: b.monthlyQuota,
        })
      : null;
    // "Remaining THIS month" — the fresh monthly slice net of what the
    // user has already burned in the current calendar month. This is
    // the number the UI shows as "Available this month"; the older
    // cumulative `monthlyAvailable` stays around because the paid/
    // unpaid split logic reads it.
    const uid = String(b.user ?? b.userRef ?? "");
    const typeId = t
      ? String((t as unknown as { _id: unknown })._id ?? "")
      : "";
    const key = uid && typeId ? `${uid}:${typeId}` : "";
    const usedThisMonth = key ? usedThisMonthMap.get(key) || 0 : 0;
    const remainingThisMonth = t
      ? computeRemainingThisMonth(
          t,
          {
            allocated: b.allocated,
            used: b.used,
            monthlyQuota: b.monthlyQuota,
          },
          usedThisMonth,
        )
      : Math.max(b.allocated - b.used, 0);
    return {
      ...b,
      monthlyAvailable,
      remainingThisMonth,
      usedThisMonth,
      yearlyRemaining: Math.max(b.allocated - b.used, 0),
      effectiveMonthlyQuota: effective,
    };
  });
}

export const getMyBalances = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const year = yearOf(req);
    const month = monthOf(req);
    const balances = await listBalancesForUser(user._id, year);
    res.status(200).json({ data: await withMonthlyAvailable(balances, year, month) });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getUserBalances = async (req: Request, res: Response) => {
  try {
    const userId = str(req.params.userId);
    const year = yearOf(req);
    const month = monthOf(req);
    const balances = await listBalancesForUser(userId, year);
    res.status(200).json({ data: await withMonthlyAvailable(balances, year, month) });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getYearBalances = async (req: Request, res: Response) => {
  try {
    const year = yearOf(req);
    const month = monthOf(req);
    const balances = await listBalancesForYear(year);
    // Decorate with `monthlyAvailable` + `effectiveMonthlyQuota` so the
    // admin grid in LeavesManagement can render the "X avail this mo"
    // line per cell. Previously this endpoint returned the raw rows and
    // the cells silently dropped the monthly line because the field was
    // missing.
    res.status(200).json({ data: await withMonthlyAvailable(balances, year, month) });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const updateAllocation = async (req: Request, res: Response) => {
  try {
    const userId = str(req.params.userId);
    const leaveTypeId = str(req.params.leaveTypeId);
    const year = Number(req.params.year);
    const { allocated, monthlyQuota } = req.body as {
      allocated?: unknown;
      // Per-user override for the LeaveType's global monthlyQuota.
      //   - `null`              → clear the override (use the type default)
      //   - number / numeric str → set the override
      //   - missing / undefined → leave the existing override untouched
      monthlyQuota?: unknown;
    };
    const options: { monthlyQuota?: number | null } = {};
    if (monthlyQuota === null) {
      options.monthlyQuota = null;
    } else if (monthlyQuota !== undefined) {
      const n = Number(monthlyQuota);
      if (Number.isFinite(n)) options.monthlyQuota = Math.max(0, n);
    }
    const doc = await setAllocation(
      userId,
      year,
      leaveTypeId,
      Number(allocated) || 0,
      options,
    );
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const triggerYearlyReset = async (req: Request, res: Response) => {
  try {
    const year = yearOf(req);
    const force = req.query.force === "true";
    const result = await resetBalancesForYear(year, { force });
    res.status(200).json({ data: result });
  } catch (error) {
    res.status(500).json({ error });
  }
};

// Per-user re-seed — overwrites the user's LeaveBalance rows for the
// given year with the current LeaveType defaults (allocated + monthly
// quota). Used by the "Reseed" button in LeavesManagement to migrate a
// single employee to a freshly updated policy without nuking everyone
// at once. Calls into the same `seedBalancesForUser` helper used by
// new-joiner onboarding and probation confirmation.
export const reseedUserBalances = async (req: Request, res: Response) => {
  try {
    const userId = str(req.params.userId);
    const year = yearOf(req);
    const force = req.query.force !== "false"; // default true for this endpoint
    const result = await seedBalancesForUser(userId, year, { force });
    res.status(200).json({ data: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
