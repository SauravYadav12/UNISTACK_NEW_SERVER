import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { FilterQuery } from "mongoose";
import { UserDoc, UserModel } from "../models/userModel";
import {
  BreakSessionDoc,
  BreakSessionModel,
  isOtpUnlockable,
} from "../models/breakSessionModel";
import { generateAndStoreOTP } from "./auth";
import {
  breakOtpTemplate,
  otpExpiryInMs,
  sendMail,
} from "../utils/mailTransporter";
import { mailSenders } from "../utils/mailSenders";
import {
  autoLockMinutes,
  closeBreak,
  findOpenBreak,
  isBreakAdmin,
  isExemptFromBreakFlow,
  startBreak,
  unlockModeFor,
} from "../services/breakService";
import {
  getBreakPolicy,
  updateBreakPolicy,
  validatePolicyPatch,
} from "../services/breakPolicyService";
import { UserRole } from "../enums/UserEnum";
import { subscribe } from "../services/breakChannel";
import {
  OFFICE_TZ,
  normaliseScope,
  officeDayRange,
  officeHoursLabel,
} from "../utils/officeTime";
import ENV_VARS from "../config/env.config";

const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;

function serialize(doc: BreakSessionDoc | null) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return { ...o, unlockMode: unlockModeFor(doc) };
}

// POST /break/start
export const start = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const result = await startBreak(user, "manual", {
      reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : undefined,
    });
    if ("error" in result) {
      if (result.error === "EXEMPT") {
        res.status(403).json({ status: "failed", code: "EXEMPT", error: "Admins are not part of the break flow." });
        return;
      }
      res.status(404).json({ status: "failed", code: "NOT_CHECKED_IN", error: "Check in before taking a break." });
      return;
    }
    res.status(result.created ? 201 : 200).json({ status: "success", data: serialize(result.doc) });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /break/request-unlock-otp
export const requestUnlockOtp = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const open = await findOpenBreak(user._id);
    if (!open) {
      res.status(404).json({ status: "failed", code: "NO_OPEN_BREAK", error: "You are not on a break." });
      return;
    }
    if (!isOtpUnlockable(open)) {
      res.status(403).json({
        status: "failed",
        code: "ADMIN_UNLOCK_REQUIRED",
        error: "Unannounced break detected. Contact your admin to unlock.",
      });
      return;
    }
    const now = Date.now();
    if (user.breakOtpLockedUntil && user.breakOtpLockedUntil.getTime() > now) {
      res.status(429).json({
        status: "failed",
        code: "OTP_LOCKED",
        retryAt: user.breakOtpLockedUntil,
        error: "Too many wrong codes. Try again later or contact your admin.",
      });
      return;
    }
    // Cooldown keyed on the BREAK code only. The login flow also writes
    // user.otp/otpExpiry, so those must not block an unlock request made
    // right after signing in.
    if (user.breakOtpSentAt && now - user.breakOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      res.status(429).json({
        status: "failed",
        code: "OTP_COOLDOWN",
        retryAt: new Date(user.breakOtpSentAt.getTime() + OTP_RESEND_COOLDOWN_MS),
        error: "A code was sent less than a minute ago. Check your inbox and spam folder.",
      });
      return;
    }
    const { error, otp } = await generateAndStoreOTP(user.email);
    if (error || !otp) {
      res.status(404).json({ status: "failed", error: "User not found." });
      return;
    }
    try {
      await sendMail({
        from: mailSenders.otp.from,
        replyTo: mailSenders.otp.replyTo,
        to: user.email,
        subject: "Your Unistack access code — end break",
        html: breakOtpTemplate(otp),
      });
    } catch (mailErr) {
      // Don't leave a half-issued code behind: the user can retry at once.
      await UserModel.updateOne({ _id: user._id }, { $set: { otp: null, otpExpiry: null } });
      console.error(`[break] unlock code email to ${user.email} FAILED:`, mailErr);
      res.status(502).json({
        status: "failed",
        code: "MAIL_FAILED",
        error: "The code could not be emailed. Try again or contact your admin.",
      });
      return;
    }
    await UserModel.updateOne({ _id: user._id }, { $set: { breakOtpSentAt: new Date(now) } });
    console.log(`[break] unlock code emailed to ${user.email} (from ${mailSenders.otp.from})`);
    res.status(200).json({
      status: "success",
      data: { sentTo: user.email, expiresInMs: otpExpiryInMs, resendAfterMs: OTP_RESEND_COOLDOWN_MS },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /break/stop  body: { otp }
export const stop = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const otp = String(req.body?.otp ?? "").trim();
    const open = await findOpenBreak(user._id);
    if (!open) {
      res.status(404).json({ status: "failed", code: "NO_OPEN_BREAK", error: "You are not on a break." });
      return;
    }
    if (!isOtpUnlockable(open)) {
      res.status(403).json({
        status: "failed",
        code: "ADMIN_UNLOCK_REQUIRED",
        error: "Unannounced break detected. Contact your admin to unlock.",
      });
      return;
    }
    const now = new Date();
    if (user.breakOtpLockedUntil && user.breakOtpLockedUntil > now) {
      res.status(429).json({
        status: "failed",
        code: "OTP_LOCKED",
        retryAt: user.breakOtpLockedUntil,
        error: "Too many wrong codes. Try again later or contact your admin.",
      });
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      res.status(400).json({ status: "failed", code: "OTP_INVALID", error: "Enter the 6-digit code." });
      return;
    }
    const match = await UserModel.findOne({ _id: user._id, otp, otpExpiry: { $gt: now } });
    if (!match) {
      const attempts = (user.breakOtpAttempts || 0) + 1;
      const update: Record<string, unknown> = { breakOtpAttempts: attempts };
      let locked = false;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.breakOtpLockedUntil = new Date(now.getTime() + OTP_LOCKOUT_MS);
        update.breakOtpAttempts = 0;
        update.otp = null;
        update.otpExpiry = null;
        locked = true;
      }
      await UserModel.updateOne({ _id: user._id }, { $set: update });
      res.status(400).json({
        status: "failed",
        code: locked ? "OTP_LOCKED" : "OTP_INVALID",
        attemptsLeft: locked ? 0 : OTP_MAX_ATTEMPTS - attempts,
        error: locked
          ? "Too many wrong codes. Locked for 15 minutes — contact your admin."
          : "Invalid or expired code.",
      });
      return;
    }
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { otp: null, otpExpiry: null, breakOtpAttempts: 0, breakOtpLockedUntil: null, breakOtpSentAt: null } },
    );
    const closed = await closeBreak(open, "otp", { at: now });
    res.status(200).json({ status: "success", data: serialize(closed) });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /break/current
export const current = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const policy = await getBreakPolicy();
    const exempt = isExemptFromBreakFlow(user, policy);
    const open = exempt ? null : await findOpenBreak(user._id);
    res.status(200).json({
      status: "success",
      data: {
        break: serialize(open),
        exempt,
        featureEnabled: policy.enabled,
        serverTime: new Date().toISOString(),
        autoLockMinutes: autoLockMinutes(policy),
        unlockMode: open ? unlockModeFor(open) : null,
        officeTz: OFFICE_TZ,
        officeHours: officeHoursLabel(),
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

function rangeFromQuery(req: Request) {
  const scope = normaliseScope(req.query.range ?? req.query.scope);
  const anchor = (req.query.date as string) || undefined;
  const { from, to } = officeDayRange(scope, anchor);
  return { scope, from, to };
}

// GET /break/logs?range=day|week|month&date=YYYY-MM-DD&userRef=
export const logs = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const admin = isBreakAdmin(user);
    const { scope, from, to } = rangeFromQuery(req);
    const filter: FilterQuery<BreakSessionDoc> = { date: { $gte: from, $lte: to } };
    if (admin) {
      const userRefFilter = req.query.userRef as string | undefined;
      if (userRefFilter) filter.userRef = userRefFilter as never;
    } else {
      filter.userRef = user._id as never;
    }
    const sessions = await BreakSessionModel.find(filter).sort({ startedAt: -1 }).lean();
    res.status(200).json({
      status: "success",
      data: {
        scope,
        from,
        to,
        sessions: sessions.map((s) => ({ ...s, unlockMode: unlockModeFor(s) })),
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

interface SummaryBucket {
  key: string;
  date?: string;
  userRef: string;
  userName?: string;
  userEmail?: string;
  count: number;
  totalSeconds: number;
  longestSeconds: number;
  unannouncedCount: number;
  openCount: number;
}

// GET /break/summary?scope=me|all&range=day|week|month&date=&userRef=
export const summary = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const admin = isBreakAdmin(user);
    const wantAll = String(req.query.scope || "me") === "all";
    if (wantAll && !admin) {
      res.status(403).json({ status: "failed", error: "Insufficient privileges" });
      return;
    }
    const { scope: range, from, to } = rangeFromQuery(req);
    const filter: FilterQuery<BreakSessionDoc> = { date: { $gte: from, $lte: to } };
    if (!wantAll) {
      filter.userRef = user._id as never;
    } else if (req.query.userRef) {
      filter.userRef = String(req.query.userRef) as never;
    }
    const sessions = await BreakSessionModel.find(filter).sort({ startedAt: 1 }).lean();
    const nowMs = Date.now();
    const perDay = new Map<string, SummaryBucket>();
    const perUser = new Map<string, SummaryBucket>();
    const totals: SummaryBucket = {
      key: "total", userRef: "", count: 0, totalSeconds: 0, longestSeconds: 0, unannouncedCount: 0, openCount: 0,
    };
    const bump = (b: SummaryBucket, seconds: number, unannounced: boolean, open: boolean) => {
      b.count += 1;
      b.totalSeconds += seconds;
      b.longestSeconds = Math.max(b.longestSeconds, seconds);
      if (unannounced) b.unannouncedCount += 1;
      if (open) b.openCount += 1;
    };
    for (const s of sessions) {
      const open = !s.endedAt;
      const seconds = open
        ? Math.max(0, Math.round((nowMs - new Date(s.startedAt).getTime()) / 1000))
        : s.durationSeconds || 0;
      const unannounced = s.source !== "manual";
      const uid = String(s.userRef);
      const dayKey = wantAll ? `${s.date}|${uid}` : s.date;
      if (!perDay.has(dayKey)) {
        perDay.set(dayKey, {
          key: dayKey, date: s.date, userRef: uid, userName: s.userName, userEmail: s.userEmail,
          count: 0, totalSeconds: 0, longestSeconds: 0, unannouncedCount: 0, openCount: 0,
        });
      }
      bump(perDay.get(dayKey) as SummaryBucket, seconds, unannounced, open);
      if (!perUser.has(uid)) {
        perUser.set(uid, {
          key: uid, userRef: uid, userName: s.userName, userEmail: s.userEmail,
          count: 0, totalSeconds: 0, longestSeconds: 0, unannouncedCount: 0, openCount: 0,
        });
      }
      bump(perUser.get(uid) as SummaryBucket, seconds, unannounced, open);
      bump(totals, seconds, unannounced, open);
    }
    const byUser = [...perUser.values()].map((b) => ({
      ...b,
      avgSeconds: b.count ? Math.round(b.totalSeconds / b.count) : 0,
    }));
    res.status(200).json({
      status: "success",
      data: {
        scope: wantAll ? "all" : "me",
        range,
        from,
        to,
        officeTz: OFFICE_TZ,
        days: [...perDay.values()].sort((a, b) => (a.date || "").localeCompare(b.date || "")),
        byUser: byUser.sort((a, b) => b.totalSeconds - a.totalSeconds),
        totals: { ...totals, avgSeconds: totals.count ? Math.round(totals.totalSeconds / totals.count) : 0 },
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /break/open  (admin) — everyone locked right now, oldest first.
export const openBreaks = async (_req: Request, res: Response) => {
  try {
    const rows = await BreakSessionModel.find({ endedAt: null }).sort({ startedAt: 1 }).lean();
    res.status(200).json({
      status: "success",
      data: {
        serverTime: new Date().toISOString(),
        breaks: rows.map((r) => ({ ...r, unlockMode: unlockModeFor(r) })),
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /break/:id/force-end  (admin) body: { reason? }
export const forceEnd = async (req: Request, res: Response) => {
  try {
    const admin = req.user as UserDoc;
    const doc = await BreakSessionModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", error: "Break not found." });
      return;
    }
    if (doc.endedAt) {
      res.status(409).json({ status: "failed", code: "ALREADY_ENDED", error: "This break has already ended." });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : undefined;
    const closed = await closeBreak(doc, "admin", { endedBy: admin, reason });
    res.status(200).json({ status: "success", data: serialize(closed) });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /break/policy  (admin) — who the feature applies to.
export const getPolicy = async (_req: Request, res: Response) => {
  try {
    res.status(200).json({ status: "success", data: await getBreakPolicy(true) });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// PUT /break/policy  (super-admin / admin) body: { enabled?, enabledRoles?, autoLockMinutes? }
export const putPolicy = async (req: Request, res: Response) => {
  try {
    const admin = req.user as UserDoc;
    const roles = admin.role || [];
    if (!roles.includes(UserRole.SuperAdmin) && !roles.includes(UserRole.Admin)) {
      res.status(403).json({ status: "failed", error: "Only admins can change the break policy." });
      return;
    }
    const v = validatePolicyPatch(req.body);
    if ("error" in v) {
      res.status(400).json({ status: "failed", error: v.error });
      return;
    }
    const policy = await updateBreakPolicy(v.patch, admin);
    // Anyone the new policy no longer covers must not stay locked.
    const open = await BreakSessionModel.find({ endedAt: null });
    let released = 0;
    for (const b of open) {
      const u = await UserModel.findById(b.userRef);
      if (!u || isExemptFromBreakFlow(u, policy)) {
        await closeBreak(b, "admin", { endedBy: admin, reason: "Break discipline disabled for this role" });
        released += 1;
      }
    }
    res.status(200).json({ status: "success", data: { policy, releasedBreaks: released } });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /break/stream?token=<jwt without "JWT " prefix>  — optional SSE.
export const stream = async (req: Request, res: Response) => {
  if (String(ENV_VARS.BREAK_SSE_ENABLED).toLowerCase() !== "true") {
    res.status(404).json({ status: "failed", error: "SSE disabled" });
    return;
  }
  const raw = String(req.query.token || "").replace(/^JWT\s+/i, "");
  let userId: string | null = null;
  try {
    const payload = jwt.verify(raw, ENV_VARS.JWT_SECRET_KEY || "your_jwt_secret_key") as {
      user?: { _id?: string };
    };
    userId = payload?.user?._id ? String(payload.user._id) : null;
  } catch {
    userId = null;
  }
  if (!userId) {
    res.status(401).json({ status: "failed", error: "Invalid token" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const open = await findOpenBreak(userId);
  res.write(`event: break:current\ndata: ${JSON.stringify({ break: serialize(open), at: new Date().toISOString() })}\n\n`);
  const unsubscribe = subscribe(userId, res);
  req.on("close", unsubscribe);
};
