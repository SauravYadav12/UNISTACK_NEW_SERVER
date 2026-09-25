import { Request, Response } from "express";
import { FilterQuery, Types } from "mongoose";
import { UserDoc, UserModel } from "../models/userModel";
import { PresenceStateModel, PresenceEventType } from "../models/presenceStateModel";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { BreakSessionModel } from "../models/breakSessionModel";
import {
  UnidentifiedEventDoc,
  UnidentifiedEventModel,
  UnidentifiedReason,
  UnidentifiedResolution,
} from "../models/unidentifiedEventModel";
import {
  BREAK_ADMIN_ROLES,
  autoLockMinutes,
  displayName,
  findOpenBreak,
  isExemptForUser,
  isExemptFromBreakFlow,
  toObjectId,
  unlockModeFor,
} from "../services/breakService";
import { getBreakPolicy } from "../services/breakPolicyService";
import { emitNotification } from "../services/notificationService";
import { uploadBuffer } from "./storageController";
import { OFFICE_TZ, IST_TZ, officeDate, officeHoursLabel, isWithinOfficeHours } from "../utils/officeTime";

const MAX_EVENT_AGE_MS = 10 * 60 * 1000;

function clampAt(raw: unknown, now = new Date()): Date {
  const parsed = raw ? new Date(String(raw)) : now;
  if (Number.isNaN(parsed.getTime())) return now;
  const min = now.getTime() - MAX_EVENT_AGE_MS;
  return new Date(Math.min(Math.max(parsed.getTime(), min), now.getTime()));
}

async function resolveUser(body: { employeeEmail?: unknown; userId?: unknown }): Promise<UserDoc | null> {
  if (typeof body.userId === "string" && Types.ObjectId.isValid(body.userId)) {
    return UserModel.findById(body.userId);
  }
  if (typeof body.employeeEmail === "string" && body.employeeEmail.includes("@")) {
    return UserModel.findOne({ email: body.employeeEmail.trim().toLowerCase() });
  }
  return null;
}

/**
 * Apply one camera event to a user's presence state. `left` only arms the
 * away timer when nothing is armed and the user is not already on a break;
 * `returned` disarms it. Neither ever ends a break — that needs OTP/admin.
 */
export async function applyPresenceEvent(
  user: UserDoc,
  type: PresenceEventType,
  at: Date,
  meta: { cameraId?: string; confidence?: number } = {},
) {
  const openBreak = await findOpenBreak(user._id);
  const base = {
    lastEventType: type,
    lastEventAt: at,
    lastCameraId: meta.cameraId,
    lastConfidence: meta.confidence,
  };
  if (type === "returned" || openBreak) {
    return PresenceStateModel.findOneAndUpdate(
      { userRef: user._id },
      { $set: { ...base, ...(type === "returned" ? { awaySince: null } : {}) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  // `left` with no open break: arm only if not already armed.
  const existing = await PresenceStateModel.findOne({ userRef: user._id });
  if (existing && existing.awaySince) {
    existing.set(base);
    await existing.save();
    return existing;
  }
  return PresenceStateModel.findOneAndUpdate(
    { userRef: user._id },
    { $set: { ...base, awaySince: at } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

// POST /presence/events   (x-api-key)
export const ingestEvent = async (req: Request, res: Response) => {
  try {
    const type = String(req.body?.type || "");
    if (type !== "left" && type !== "returned") {
      res.status(400).json({ status: "failed", error: "type must be 'left' or 'returned'" });
      return;
    }
    const user = await resolveUser(req.body || {});
    if (!user) {
      res.status(404).json({ status: "failed", error: "Employee not found" });
      return;
    }
    if (await isExemptForUser(user)) {
      res.status(200).json({ status: "success", data: { ignored: "exempt" } });
      return;
    }
    const at = clampAt(req.body?.at);
    const confidence = Number(req.body?.confidence);
    const state = await applyPresenceEvent(user, type, at, {
      cameraId: typeof req.body?.cameraId === "string" ? req.body.cameraId : undefined,
      confidence: Number.isFinite(confidence) ? confidence : undefined,
    });
    res.status(200).json({
      status: "success",
      data: {
        userRef: user._id,
        awaySince: state?.awaySince ?? null,
        onBreak: !!(await findOpenBreak(user._id)),
        autoLockMinutes: autoLockMinutes(await getBreakPolicy()),
        withinOfficeHours: isWithinOfficeHours(at),
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /presence/unidentified  (x-api-key, multipart: image + fields)
export const ingestUnidentified = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "failed", error: "image is required" });
      return;
    }
    const direction = String(req.body?.direction || "");
    const reason = String(req.body?.reason || "no_face") as UnidentifiedReason;
    if (direction !== "in" && direction !== "out") {
      res.status(400).json({ status: "failed", error: "direction must be 'in' or 'out'" });
      return;
    }
    if (!["no_face", "low_confidence", "occluded"].includes(reason)) {
      res.status(400).json({ status: "failed", error: "invalid reason" });
      return;
    }
    const cameraId = String(req.body?.cameraId || "unknown");
    const at = clampAt(req.body?.at);
    const ext = req.file.mimetype === "image/png" ? "png" : "jpg";
    const key = `presence/unidentified/${officeDate(at).replace(/-/g, "/")}/${at.getTime()}-${cameraId}.${ext}`;
    const imageUrl = await uploadBuffer(req.file.buffer, key, req.file.mimetype);
    const doc = await UnidentifiedEventModel.create({
      at,
      cameraId,
      direction,
      reason,
      imageUrl,
      imageKey: key,
      resolution: "pending",
    });
    const admins = await UserModel.find({ role: { $in: BREAK_ADMIN_ROLES }, active: true }).distinct("_id");
    await emitNotification({
      recipients: admins,
      type: "presence.unidentified",
      title: `Unidentified person ${direction === "out" ? "left" : "entered"} — camera ${cameraId}`,
      body: `Face not recognised (${reason.replace("_", " ")}). Review the snapshot in Attendance Dashboard → Unidentified.`,
      link: { kind: "break", unidentifiedId: String(doc._id) },
      dedupeKey: `unidentified:${doc._id}`,
    });
    res.status(201).json({ status: "success", data: doc });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /presence/unidentified?resolution=pending|all&limit=
export const listUnidentified = async (req: Request, res: Response) => {
  try {
    const resolution = String(req.query.resolution || "pending");
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const filter: FilterQuery<UnidentifiedEventDoc> =
      resolution === "all" ? {} : { resolution: resolution as UnidentifiedResolution };
    const rows = await UnidentifiedEventModel.find(filter).sort({ at: -1 }).limit(limit).lean();
    res.status(200).json({ status: "success", data: rows });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /presence/unidentified/:id/resolve  body: { resolution, userId?, note? }
export const resolveUnidentified = async (req: Request, res: Response) => {
  try {
    const admin = req.user as UserDoc;
    const doc = await UnidentifiedEventModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", error: "Not found" });
      return;
    }
    const resolution = String(req.body?.resolution || "") as UnidentifiedResolution;
    if (!["assigned", "visitor", "dismissed"].includes(resolution)) {
      res.status(400).json({ status: "failed", error: "resolution must be assigned | visitor | dismissed" });
      return;
    }
    if (resolution === "assigned") {
      const userId = String(req.body?.userId || "");
      const user = Types.ObjectId.isValid(userId) ? await UserModel.findById(userId) : null;
      if (!user) {
        res.status(400).json({ status: "failed", error: "userId is required to assign" });
        return;
      }
      doc.resolvedUserRef = user._id;
      if (!(await isExemptForUser(user))) {
        await applyPresenceEvent(user, doc.direction === "out" ? "left" : "returned", doc.at, {
          cameraId: doc.cameraId,
        });
      }
    }
    doc.resolution = resolution;
    doc.reviewedByRef = admin._id;
    doc.reviewedByName = displayName(admin);
    doc.reviewedAt = new Date();
    if (typeof req.body?.note === "string") doc.note = req.body.note.slice(0, 300);
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

export type BoardStatus =
  | "working"
  | "break"
  | "unannounced"
  | "away_pending"
  | "checked_out"
  | "not_checked_in";

const STATUS_ORDER: Record<BoardStatus, number> = {
  unannounced: 0,
  break: 1,
  away_pending: 2,
  working: 3,
  checked_out: 4,
  not_checked_in: 5,
};

// GET /presence/board  (any employee)
export const board = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const users = await UserModel.find({ active: true })
      .select("firstName lastName email role shift")
      .lean();
    const policy = await getBreakPolicy();
    const employees = users.filter((u) => !isExemptFromBreakFlow(u, policy));
    const ids = employees.map((u) => u._id);
    const [openCheckIns, openBreaks, states, recentCheckouts] = await Promise.all([
      CheckInSessionModel.find({ userRef: { $in: ids }, checkOutAt: null }).lean(),
      BreakSessionModel.find({ userRef: { $in: ids }, endedAt: null }).lean(),
      PresenceStateModel.find({ userRef: { $in: ids } }).lean(),
      CheckInSessionModel.find({
        userRef: { $in: ids },
        checkOutAt: { $gte: new Date(now.getTime() - 16 * 60 * 60 * 1000) },
      })
        .select("userRef checkOutAt")
        .lean(),
    ]);
    const byUser = <T extends { userRef: unknown }>(rows: T[]) => {
      const m = new Map<string, T>();
      for (const r of rows) m.set(String(r.userRef), r);
      return m;
    };
    const ci = byUser(openCheckIns);
    const br = byUser(openBreaks);
    const ps = byUser(states);
    const co = byUser(recentCheckouts);

    const rows = employees.map((u) => {
      const id = String(u._id);
      const checkIn = ci.get(id);
      const brk = br.get(id);
      const state = ps.get(id);
      let status: BoardStatus = "not_checked_in";
      let since: Date | null = null;
      if (brk) {
        status = brk.source === "manual" ? "break" : "unannounced";
        since = brk.startedAt;
      } else if (checkIn) {
        if (state?.awaySince) {
          status = "away_pending";
          since = state.awaySince;
        } else {
          status = "working";
          since = checkIn.checkInAt;
        }
      } else if (co.get(id)) {
        status = "checked_out";
        since = co.get(id)?.checkOutAt ?? null;
      }
      return {
        userRef: id,
        name: displayName(u as UserDoc),
        email: u.email,
        shift: u.shift,
        status,
        since,
        breakId: brk ? String(brk._id) : null,
        unlockMode: brk ? unlockModeFor(brk) : null,
      };
    });
    rows.sort((a, b) => {
      const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    const counts = rows.reduce(
      (acc, r) => {
        acc[r.status] += 1;
        return acc;
      },
      { working: 0, break: 0, unannounced: 0, away_pending: 0, checked_out: 0, not_checked_in: 0 } as Record<BoardStatus, number>,
    );
    res.status(200).json({
      status: "success",
      data: {
        serverTime: now.toISOString(),
        officeTz: OFFICE_TZ,
        istTz: IST_TZ,
        officeHours: officeHoursLabel(now),
        withinOfficeHours: isWithinOfficeHours(now),
        counts,
        rows,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

export { toObjectId };
