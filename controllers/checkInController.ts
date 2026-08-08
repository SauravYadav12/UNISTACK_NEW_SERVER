import { Request, Response } from "express";
import moment from "moment-timezone";
import { FilterQuery } from "mongoose";
import {
  CheckInSessionModel,
  CheckInSessionDoc,
  CheckoutSource,
  MAX_SESSION_MS,
} from "../models/checkInSessionModel";
import { AttendanceModel, AttendanceStatus } from "../models/attendance";
import { handleMarkAttendance } from "./attendanceController";
import { UserDoc } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { UserShift } from "../interface/constants";

// Shift → IANA timezone. Everything about "which calendar day is this
// check-in on" is resolved in the employee's own timezone so a US-shift
// employee checking in at 11pm EST doesn't get logged on the next IST day.
function tzForShift(shift?: string): string {
  return shift === UserShift.India ? "Asia/Kolkata" : "America/New_York";
}

// Log grouping key — `YYYY-MM-DD` in the employee's timezone.
function sessionDate(shift: string | undefined, at: Date): string {
  return moment.tz(at, tzForShift(shift)).format("YYYY-MM-DD");
}

// Attendance rows use `YYYY/MM/DD` (slash) + a weekend guard.
function attendanceDate(shift: string | undefined, at: Date): string {
  return moment.tz(at, tzForShift(shift)).format("YYYY/MM/DD");
}

function isWeekend(shift: string | undefined, at: Date): boolean {
  const dow = moment.tz(at, tzForShift(shift)).day();
  return dow === 0 || dow === 6;
}

/**
 * Best-effort: mark the employee Present on the Attendance row for today.
 * Reuses handleMarkAttendance which already dup-guards + weekend-guards,
 * so a second check-in, an existing (e.g. leave-created Absent) row, or a
 * weekend all resolve to a silent no-op. Never blocks the check-in.
 */
async function markPresentForCheckIn(user: UserDoc, at: Date): Promise<void> {
  try {
    await handleMarkAttendance({
      userRef: String(user._id),
      date: attendanceDate(user.shift as string | undefined, at),
      status: AttendanceStatus.Present,
    });
  } catch {
    // Already marked / weekend / any validation error — intentionally ignored.
  }
}

/**
 * Best-effort: stamp checkOut on today's Attendance row so the attendance
 * table's own check-in/out display stays consistent with the session.
 */
async function stampAttendanceCheckout(
  user: UserDoc,
  checkInAt: Date,
  checkOutAt: Date
): Promise<void> {
  try {
    const date = attendanceDate(user.shift as string | undefined, checkInAt);
    await AttendanceModel.findOneAndUpdate(
      { userRef: user._id as never, date },
      { checkOut: checkOutAt }
    );
  } catch {
    // non-fatal
  }
}

/**
 * Close any OPEN session for this user that has already run past the 14h
 * cap. Returns nothing; usually closes 0 or 1 rows. Called on check-in and
 * on `current` reads so a forgotten session is finalized the moment anyone
 * looks, independent of the background sweep.
 */
export async function finalizeStaleForUser(user: UserDoc): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_SESSION_MS);
  const stale = await CheckInSessionModel.find({
    userRef: user._id,
    checkOutAt: null,
    checkInAt: { $lte: cutoff },
  });
  for (const s of stale) {
    const closeAt = new Date(s.checkInAt.getTime() + MAX_SESSION_MS);
    s.checkOutAt = closeAt;
    s.autoCheckout = true;
    s.checkoutSource = "auto";
    s.durationSeconds = Math.round(MAX_SESSION_MS / 1000);
    await s.save();
    await stampAttendanceCheckout(user, s.checkInAt, closeAt);
  }
}

// POST /checkin
export const checkIn = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    // First close anything already past 14h so we never end up with two
    // open sessions.
    await finalizeStaleForUser(user);

    // Idempotent: if a valid (< 14h) open session exists, return it rather
    // than creating a duplicate. (Returned even on a weekend so a session
    // left open from Friday still displays + can be checked out.)
    const existingOpen = await CheckInSessionModel.findOne({
      userRef: user._id,
      checkOutAt: null,
    });
    if (existingOpen) {
      res.status(200).json({ status: "success", data: existingOpen });
      return;
    }

    const now = new Date();

    // No NEW check-ins on weekends — Sat/Sun are company-wide non-working
    // days (resolved in the employee's own timezone).
    if (isWeekend(user.shift as string | undefined, now)) {
      res.status(400).json({
        status: "failed",
        error: "Check-in is not allowed on weekends.",
      });
      return;
    }

    const session = await CheckInSessionModel.create({
      userRef: user._id,
      userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      userEmail: user.email,
      shift: user.shift,
      date: sessionDate(user.shift as string | undefined, now),
      checkInAt: now,
      checkOutAt: null,
    });

    // Per product decision: check-in also marks the employee Present.
    if (!isWeekend(user.shift as string | undefined, now)) {
      await markPresentForCheckIn(user, now);
    }

    res.status(201).json({ status: "success", data: session });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /checkout   body: { source?: 'manual' | 'logout' }
export const checkOut = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const rawSource = (req.body?.source as string) || "manual";
    const source: CheckoutSource =
      rawSource === "logout" ? "logout" : "manual";

    const session = await CheckInSessionModel.findOne({
      userRef: user._id,
      checkOutAt: null,
    });
    // Nothing open — treat as a no-op success so logout never fails on it.
    if (!session) {
      res.status(200).json({ status: "success", data: null });
      return;
    }

    const now = new Date();
    // Cap the recorded checkout at 14h even on a manual click well past it.
    const cap = new Date(session.checkInAt.getTime() + MAX_SESSION_MS);
    const closeAt = now > cap ? cap : now;
    session.checkOutAt = closeAt;
    session.autoCheckout = now > cap; // ran over the cap → flag it
    session.checkoutSource = now > cap ? "auto" : source;
    session.durationSeconds = Math.round(
      (closeAt.getTime() - session.checkInAt.getTime()) / 1000
    );
    await session.save();

    await stampAttendanceCheckout(user, session.checkInAt, closeAt);

    res.status(200).json({ status: "success", data: session });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /checkin/current  → the caller's currently-open session (or null)
export const current = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    await finalizeStaleForUser(user);
    const session = await CheckInSessionModel.findOne({
      userRef: user._id,
      checkOutAt: null,
    });
    res.status(200).json({
      status: "success",
      data: {
        session: session || null,
        serverTime: new Date().toISOString(),
        maxSessionMs: MAX_SESSION_MS,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

/**
 * GET /checkin/logs?scope=day|week|month&date=YYYY-MM-DD&userRef=<id>
 *
 * Super-admin: sees every employee's sessions (optionally filtered to one
 * user). Everyone else: forced to their OWN sessions only, regardless of
 * any userRef they pass. Range is computed in the caller's shift timezone
 * and matched against the stored `date` string (lexicographic — safe for
 * YYYY-MM-DD).
 */
export const logs = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const isSuperAdmin = (user.role || []).includes(UserRole.SuperAdmin);

    const scope = ((req.query.scope as string) || "day").toLowerCase();
    const anchorStr = (req.query.date as string) || undefined;
    const tz = tzForShift(user.shift as string | undefined);
    const anchor = anchorStr
      ? moment.tz(anchorStr, "YYYY-MM-DD", tz)
      : moment.tz(tz);

    let from = anchor.clone().startOf("day");
    let to = anchor.clone().endOf("day");
    if (scope === "week") {
      from = anchor.clone().startOf("isoWeek");
      to = anchor.clone().endOf("isoWeek");
    } else if (scope === "month") {
      from = anchor.clone().startOf("month");
      to = anchor.clone().endOf("month");
    }
    const fromDate = from.format("YYYY-MM-DD");
    const toDate = to.format("YYYY-MM-DD");

    const filter: FilterQuery<CheckInSessionDoc> = {
      date: { $gte: fromDate, $lte: toDate },
    };
    if (isSuperAdmin) {
      const userRefFilter = req.query.userRef as string | undefined;
      if (userRefFilter) filter.userRef = userRefFilter as never;
    } else {
      // Non-super-admins only ever see their own log.
      filter.userRef = user._id as never;
    }

    const sessions = await CheckInSessionModel.find(filter)
      .sort({ checkInAt: -1 })
      .lean();

    res.status(200).json({
      status: "success",
      data: {
        scope,
        from: fromDate,
        to: toDate,
        sessions,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};
