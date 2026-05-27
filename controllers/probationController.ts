/**
 * Probation workflow controller.
 *
 * The probation period for a new joiner runs for 90 days from their
 * `dateOfJoining`. During that window, paid leaves do NOT accrue —
 * the leave engine treats the employee as `allocated: 0` for every
 * paid type. Once the 90 days are up, the daily cron fires a
 * notification to all admins / super-admins; one of them then opens
 * the Employee Management page and either:
 *
 *   • **Confirms** with an optional `endDate` (defaults to today;
 *     backdate to retroactively credit, future-date to delay).
 *     Re-seeds balances using the chosen date as the leave-start
 *     anchor.
 *
 *   • **Extends** by N days (and an optional reason). The original
 *     end date moves forward by N days; the cron will nudge again
 *     once that new date arrives. `probationExtensionDays` is
 *     incremented for the audit trail.
 *
 * Both endpoints are admin/super-admin only. No auto-confirmation —
 * if no one acts, the user simply continues with zero accrual and
 * a daily notification reminder.
 */

import { Request, Response } from "express";
import { FilterQuery, Types } from "mongoose";
import { UserModel, UserDoc } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { seedBalancesForUser } from "../services/leaveBalanceService";
import {
  PROBATION_FEATURE_LAUNCH_DATE,
  computeProbationOriginalEndDate,
} from "../utils/probation";

const NOT_SUPER_ADMIN_FILTER = {
  role: { $not: { $elemMatch: { $eq: "super-admin" } } },
} as const;

/**
 * GET /probation/pending
 *
 * Returns the list of active employees whose probation window has
 * elapsed (originalEndDate <= today) and who haven't been confirmed
 * yet. Admin UI uses this to render the approval table.
 *
 * We deliberately INCLUDE employees still inside their 90-day window
 * too — surfaced with `overdue: false` — so HR can act early (early
 * confirmation is allowed by the spec). The UI sorts overdue first.
 */
export const listPendingProbations = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const today = new Date();
    // Match BOTH:
    //   (a) profiles with `probationStatus = 'in_progress'` (new flow), OR
    //   (b) legacy profiles created before today's status field
    //       existed, where DOJ falls on/after the feature launch.
    //       Under the new rule these employees are implicitly
    //       in_progress until an admin confirms.
    // The $or lets the admin start using the page immediately without
    // running a backfill migration.
    const profileFilter = {
      $or: [
        { probationStatus: "in_progress" },
        {
          probationStatus: { $exists: false },
          dateOfJoining: { $gte: PROBATION_FEATURE_LAUNCH_DATE },
        },
      ],
    } as FilterQuery<Record<string, unknown>>;
    const profiles = await UserProfileModel.find(profileFilter)
      .select(
        "user dateOfJoining probationOriginalEndDate probationExtensionDays probationStatus",
      )
      .sort({ probationOriginalEndDate: 1 })
      .lean();

    if (!profiles.length) {
      res.status(200).json({ data: [] });
      return;
    }

    // Hydrate user details — skip inactive employees (deactivated mid-
    // probation, e.g. someone who didn't make it past the trial period).
    const userIds = profiles.map((p) => p.user);
    const userFilter = {
      _id: { $in: userIds },
      active: true,
      ...NOT_SUPER_ADMIN_FILTER,
    } as FilterQuery<Record<string, unknown>>;
    const users = await UserModel.find(userFilter)
      .select("firstName lastName email")
      .lean();
    const userMap = new Map<string, (typeof users)[number]>();
    for (const u of users) userMap.set(String(u._id), u);

    const data = profiles
      .filter((p) => userMap.has(String(p.user)))
      .map((p) => {
        const u = userMap.get(String(p.user))!;
        // Compute originalEnd on the fly for legacy profiles. The
        // explicit value (stored on the row) wins when present; the
        // DOJ+90d fallback covers profiles created before the field
        // existed.
        const orig =
          (p.probationOriginalEndDate
            ? new Date(p.probationOriginalEndDate)
            : null) ??
          (p.dateOfJoining
            ? computeProbationOriginalEndDate(new Date(p.dateOfJoining))
            : null);
        const daysOverdue = orig
          ? Math.floor((today.getTime() - orig.getTime()) / (24 * 60 * 60 * 1000))
          : null;
        return {
          userId: String(p.user),
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          dateOfJoining: p.dateOfJoining,
          probationOriginalEndDate: orig,
          probationExtensionDays: p.probationExtensionDays ?? 0,
          // Negative if the window hasn't elapsed yet, positive if past
          // due. UI uses the sign to colour-code the row.
          daysOverdue,
          overdue: orig ? orig.getTime() <= today.getTime() : false,
        };
      });

    res.status(200).json({ data });
  } catch (error) {
    console.error("[probation] listPending failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * POST /probation/:userId/confirm
 * Body: { endDate?: string (ISO), notes?: string }
 *
 * Marks probation as confirmed. `endDate` defaults to the request's
 * "now" — backdating is allowed (admin saw the prompt late; retroactive
 * credit), forward-dating is allowed (early confirmation that takes
 * effect from a chosen later date is also fine). After updating the
 * profile, balances are force re-seeded for the current year so the
 * new leave-start anchor is reflected.
 */
export const confirmProbation = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const targetUserId = String(req.params.userId || "");
    if (!Types.ObjectId.isValid(targetUserId)) {
      res.status(400).json({ error: "Invalid userId." });
      return;
    }
    const admin = req.user as UserDoc;

    const endDateRaw = (req.body || {}).endDate;
    const endDate = endDateRaw ? new Date(String(endDateRaw)) : new Date();
    if (Number.isNaN(endDate.getTime())) {
      res.status(400).json({ error: "Invalid endDate." });
      return;
    }

    const profileFilter = {
      user: new Types.ObjectId(targetUserId),
    } as FilterQuery<Record<string, unknown>>;
    const profile = await UserProfileModel.findOne(profileFilter).select(
      "probationStatus dateOfJoining probationOriginalEndDate",
    );
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    if (profile.probationStatus === "confirmed") {
      res.status(409).json({ error: "Probation is already confirmed." });
      return;
    }

    // Legacy profiles may not have probationOriginalEndDate stamped.
    // Backfill it from DOJ during this confirm flow so the audit trail
    // is complete (we record the originally-expected end date alongside
    // the actual admin-chosen end date).
    const set: Record<string, unknown> = {
      probationStatus: "confirmed",
      probationEndDate: endDate,
      probationConfirmedAt: new Date(),
      probationConfirmedBy: admin._id,
    };
    if (!profile.probationOriginalEndDate && profile.dateOfJoining) {
      set.probationOriginalEndDate = computeProbationOriginalEndDate(
        new Date(profile.dateOfJoining),
      );
    }
    await UserProfileModel.updateOne(profileFilter, { $set: set });

    // Re-seed balances for the CURRENT year so the chosen endDate
    // becomes the leave-start anchor. If the year on the endDate is
    // different (admin backdated to last year), the current-year seed
    // still picks up its anchor from probationEndDate.
    let upserted = 0;
    try {
      const r = await seedBalancesForUser(
        targetUserId,
        new Date().getFullYear(),
        { force: true },
      );
      upserted = r.upserted;
    } catch (e) {
      console.error(
        `[probation] re-seed failed for user ${targetUserId}:`,
        (e as Error).message,
      );
    }

    res.status(200).json({
      data: {
        userId: targetUserId,
        probationStatus: "confirmed",
        probationEndDate: endDate,
        balancesUpdated: upserted,
      },
    });
  } catch (error) {
    console.error("[probation] confirm failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * POST /probation/:userId/extend
 * Body: { days: number, reason?: string }
 *
 * Pushes the originalEndDate forward by `days` days and bumps the
 * extension counter. The cron will re-fire its notification once the
 * new date elapses. Does NOT change status — the employee is still
 * 'in_progress'. Reason is logged for audit but not stored
 * structurally (lightweight first cut).
 */
export const extendProbation = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const targetUserId = String(req.params.userId || "");
    if (!Types.ObjectId.isValid(targetUserId)) {
      res.status(400).json({ error: "Invalid userId." });
      return;
    }
    const admin = req.user as UserDoc;

    const daysRaw = Number((req.body || {}).days);
    if (!Number.isFinite(daysRaw) || daysRaw <= 0 || daysRaw > 365) {
      res.status(400).json({
        error: "`days` must be a positive number, at most 365.",
      });
      return;
    }
    const days = Math.floor(daysRaw);
    const reason = String((req.body || {}).reason || "").trim();

    const profileFilter = {
      user: new Types.ObjectId(targetUserId),
    } as FilterQuery<Record<string, unknown>>;
    const profile = await UserProfileModel.findOne(profileFilter).select(
      "probationStatus probationOriginalEndDate probationExtensionDays dateOfJoining",
    );
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    if (profile.probationStatus === "confirmed") {
      res.status(409).json({
        error: "Cannot extend a confirmed probation. Already finalised.",
      });
      return;
    }

    // Anchor for the addition: existing originalEndDate (if set), else
    // DOJ+90d for legacy profiles, else today (last-resort defensive).
    const baseDate = profile.probationOriginalEndDate
      ? new Date(profile.probationOriginalEndDate)
      : profile.dateOfJoining
        ? computeProbationOriginalEndDate(new Date(profile.dateOfJoining))
        : new Date();
    const newEnd = new Date(baseDate);
    newEnd.setDate(newEnd.getDate() + days);

    // Also stamp probationStatus = 'in_progress' for legacy profiles
    // that didn't have it set — the extend action implicitly enrols
    // them into the new flow.
    const setOnExtend: Record<string, unknown> = {
      probationOriginalEndDate: newEnd,
    };
    if (!profile.probationStatus) setOnExtend.probationStatus = "in_progress";
    await UserProfileModel.updateOne(profileFilter, {
      $set: setOnExtend,
      $inc: { probationExtensionDays: days },
    });

    console.log(
      `[probation] Extended user=${targetUserId} by ${days}d (new end=${newEnd.toISOString()}, by=${admin._id}, reason="${reason}")`,
    );

    res.status(200).json({
      data: {
        userId: targetUserId,
        probationOriginalEndDate: newEnd,
        addedDays: days,
        totalExtensionDays:
          (profile.probationExtensionDays ?? 0) + days,
      },
    });
  } catch (error) {
    console.error("[probation] extend failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * GET /employee-management/employees
 *
 * Lists every active, non-super-admin employee with their DOJ and a
 * compact probation summary. Powers the "Joining dates" tab in
 * Employee Management where super-admin can backfill / correct DOJ
 * for any employee.
 *
 * Returns rows sorted by employees who DON'T have a DOJ first (those
 * need attention), then by joining date ascending.
 */
export const listEmployeesWithJoiningDates = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    // 1. All active, non-super-admin users.
    const userFilter = {
      active: true,
      ...NOT_SUPER_ADMIN_FILTER,
    } as FilterQuery<Record<string, unknown>>;
    const users = await UserModel.find(userFilter)
      .select("firstName lastName email role")
      .sort({ firstName: 1 })
      .lean();
    if (!users.length) {
      res.status(200).json({ data: [] });
      return;
    }

    // 2. Hydrate each user's profile snapshot in a single batched query.
    const userIds = users.map((u) => u._id);
    const profileFilter = {
      user: { $in: userIds },
    } as FilterQuery<Record<string, unknown>>;
    const profiles = await UserProfileModel.find(profileFilter)
      .select(
        "user dateOfJoining probationStatus probationOriginalEndDate probationEndDate relievingDate",
      )
      .lean();
    const profMap = new Map<string, (typeof profiles)[number]>();
    for (const p of profiles) profMap.set(String(p.user), p);

    const data = users.map((u) => {
      const p = profMap.get(String(u._id));
      return {
        userId: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        dateOfJoining: p?.dateOfJoining ?? null,
        probationStatus: p?.probationStatus ?? null,
        probationOriginalEndDate: p?.probationOriginalEndDate ?? null,
        probationEndDate: p?.probationEndDate ?? null,
        relievingDate: p?.relievingDate ?? null,
        hasProfile: Boolean(p),
      };
    });

    // Sort: missing DOJ first, then by DOJ ascending.
    data.sort((a, b) => {
      if (!a.dateOfJoining && b.dateOfJoining) return -1;
      if (a.dateOfJoining && !b.dateOfJoining) return 1;
      if (!a.dateOfJoining && !b.dateOfJoining) return 0;
      return (
        new Date(a.dateOfJoining as Date).getTime() -
        new Date(b.dateOfJoining as Date).getTime()
      );
    });

    res.status(200).json({ data });
  } catch (error) {
    console.error(
      "[employee-mgmt] list joining dates failed:",
      (error as Error).message,
    );
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * PATCH /employee-management/employees/:userId/joining-date
 * Body: { dateOfJoining: ISO date string }
 *
 * Super-admin (or admin via ACL) sets / corrects the DOJ for any
 * employee. Side effects:
 *
 *   - If the profile doesn't exist yet, returns 404 (the profile-create
 *     flow auto-stamps DOJ; an explicit "edit DOJ" only makes sense for
 *     existing profiles).
 *   - The DOJ field is updated.
 *   - If `probationStatus = 'in_progress'` (or unset legacy), the
 *     `probationOriginalEndDate` is recomputed as DOJ + 90d. This
 *     ensures the cron + dashboard banner reflect the new clock.
 *   - If `probationStatus = 'confirmed'`, originalEndDate stays —
 *     the probation is already finalised and the audit trail should
 *     show the original timeline.
 *   - Leave balances for the current year are force-re-seeded so
 *     prorata / probation-aware allocation reflects the new DOJ.
 *     `used` is preserved (see seedBalancesForUser docstring).
 */
export const updateEmployeeJoiningDate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const targetUserId = String(req.params.userId || "");
    if (!Types.ObjectId.isValid(targetUserId)) {
      res.status(400).json({ error: "Invalid userId." });
      return;
    }

    const dojRaw = (req.body || {}).dateOfJoining;
    if (!dojRaw) {
      res.status(400).json({ error: "`dateOfJoining` is required." });
      return;
    }
    const newDoj = new Date(String(dojRaw));
    if (Number.isNaN(newDoj.getTime())) {
      res.status(400).json({ error: "Invalid `dateOfJoining`." });
      return;
    }
    // Sanity bounds — block obviously-wrong values (e.g. typos like
    // 1925 or 2099). Outside ±20 years of today is rejected.
    const yearsAway =
      Math.abs(newDoj.getFullYear() - new Date().getFullYear());
    if (yearsAway > 20) {
      res.status(400).json({
        error: "`dateOfJoining` is more than 20 years away — looks wrong.",
      });
      return;
    }

    const profileFilter = {
      user: new Types.ObjectId(targetUserId),
    } as FilterQuery<Record<string, unknown>>;
    const profile = await UserProfileModel.findOne(profileFilter).select(
      "probationStatus dateOfJoining",
    );
    if (!profile) {
      res.status(404).json({
        error: "Profile not found. Activate the employee first.",
      });
      return;
    }

    const set: Record<string, unknown> = { dateOfJoining: newDoj };
    // Only recompute originalEndDate when probation is still pending.
    // For confirmed users the original window is historical and should
    // remain stable.
    if (
      !profile.probationStatus ||
      profile.probationStatus === "in_progress"
    ) {
      set.probationOriginalEndDate = computeProbationOriginalEndDate(newDoj);
    }
    await UserProfileModel.updateOne(profileFilter, { $set: set });

    // Recompute leave balances for the current year. `used` is preserved
    // so we don't erase any leaves already taken under the prior DOJ.
    let upserted = 0;
    try {
      const r = await seedBalancesForUser(
        targetUserId,
        new Date().getFullYear(),
        { force: true },
      );
      upserted = r.upserted;
    } catch (e) {
      console.error(
        `[employee-mgmt] re-seed failed for user ${targetUserId}:`,
        (e as Error).message,
      );
    }

    res.status(200).json({
      data: {
        userId: targetUserId,
        dateOfJoining: newDoj,
        probationOriginalEndDate: set.probationOriginalEndDate ?? null,
        balancesUpdated: upserted,
      },
    });
  } catch (error) {
    console.error(
      "[employee-mgmt] update joining-date failed:",
      (error as Error).message,
    );
    res.status(500).json({ error: (error as Error).message });
  }
};

