import { Request, Response } from "express";
import { UserDoc } from "../interface";
import {
  listBalancesForUser,
  listBalancesForYear,
  setAllocation,
  resetBalancesForYear,
  computeMonthlyAvailable,
} from "../services/leaveBalanceService";
import { LeaveTypeDoc } from "../models/leaveTypeModel";

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
// off that.
function withMonthlyAvailable<
  T extends { leaveType: unknown; allocated: number; used: number }
>(rows: T[], month: number) {
  return rows.map((b) => {
    const t = b.leaveType as LeaveTypeDoc | null | undefined;
    const monthlyAvailable = t
      ? computeMonthlyAvailable(t, { allocated: b.allocated, used: b.used }, month)
      : Math.max(b.allocated - b.used, 0);
    return { ...b, monthlyAvailable };
  });
}

export const getMyBalances = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const year = yearOf(req);
    const month = monthOf(req);
    const balances = await listBalancesForUser(user._id, year);
    res.status(200).json({ data: withMonthlyAvailable(balances, month) });
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
    res.status(200).json({ data: withMonthlyAvailable(balances, month) });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getYearBalances = async (req: Request, res: Response) => {
  try {
    const year = yearOf(req);
    const balances = await listBalancesForYear(year);
    res.status(200).json({ data: balances });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const updateAllocation = async (req: Request, res: Response) => {
  try {
    const userId = str(req.params.userId);
    const leaveTypeId = str(req.params.leaveTypeId);
    const year = Number(req.params.year);
    const { allocated } = req.body;
    const doc = await setAllocation(
      userId,
      year,
      leaveTypeId,
      Number(allocated) || 0,
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
