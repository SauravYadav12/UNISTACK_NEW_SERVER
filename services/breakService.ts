import mongoose, { Types } from "mongoose";
import {
  BreakSessionDoc,
  BreakSessionModel,
  BreakEndedSource,
  BreakSource,
  isOtpUnlockable,
} from "../models/breakSessionModel";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { PresenceStateModel } from "../models/presenceStateModel";
import { UserDoc, UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { emitNotification } from "./notificationService";
import { officeDate } from "../utils/officeTime";
import { publish } from "./breakChannel";
import { BreakPolicy, getBreakPolicy, roleFlowEnabled } from "./breakPolicyService";

/**
 * Break-discipline domain logic shared by the controllers, the presence
 * ingest and the sweep scheduler. Controllers stay thin; every rule about
 * WHO can be locked and HOW a break ends lives here.
 */

export const BREAK_ADMIN_ROLES: UserRole[] = [
  UserRole.SuperAdmin,
  UserRole.Admin,
  UserRole.Hr,
];

export function autoLockMinutes(policy: BreakPolicy): number {
  return policy.autoLockMinutes;
}

/**
 * Who is OUT of the break flow (no Break button, no lock screen, no
 * presence lock, not on the board) is decided by the BreakPolicy: a master
 * switch plus the set of roles it applies to. Super-admins are always out;
 * admins are out by default but can be switched on. Pass the policy you
 * already fetched, or use `isExemptForUser` for a one-off check.
 */
export function isExemptFromBreakFlow(
  user: { role?: string[] | null } | null | undefined,
  policy: BreakPolicy,
): boolean {
  return !roleFlowEnabled(user, policy);
}

export async function isExemptForUser(
  user: { role?: string[] | null } | null | undefined,
): Promise<boolean> {
  return isExemptFromBreakFlow(user, await getBreakPolicy());
}

export function isBreakAdmin(user: { role?: string[] | null } | null | undefined): boolean {
  const roles = user?.role || [];
  return BREAK_ADMIN_ROLES.some((r) => roles.includes(r));
}

export function displayName(user: Pick<UserDoc, "firstName" | "lastName" | "email">): string {
  const n = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return n || user.email;
}

export async function findOpenBreak(
  userId: Types.ObjectId | string,
): Promise<BreakSessionDoc | null> {
  return BreakSessionModel.findOne({ userRef: userId, endedAt: null });
}

export async function findOpenCheckIn(userId: Types.ObjectId | string) {
  return CheckInSessionModel.findOne({ userRef: userId, checkOutAt: null });
}

/** Compact shape returned on login / sync so the client can lock on first paint. */
export async function openBreakSummary(userId: Types.ObjectId | string) {
  const b = await findOpenBreak(userId);
  if (!b) return null;
  return {
    _id: b._id,
    source: b.source,
    startedAt: b.startedAt,
    unlockMode: isOtpUnlockable(b) ? "otp" : "admin",
  };
}

function toEvent(doc: BreakSessionDoc) {
  return {
    _id: doc._id,
    userRef: doc.userRef,
    userName: doc.userName,
    source: doc.source,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    endedSource: doc.endedSource,
    durationSeconds: doc.durationSeconds,
  };
}

async function activeRecipientIds(exclude: Types.ObjectId): Promise<Types.ObjectId[]> {
  // "Active users" = everyone with an open check-in, plus the admin/HR
  // operators who never check in but must always know who is away.
  const [open, admins] = await Promise.all([
    CheckInSessionModel.find({ checkOutAt: null }).distinct("userRef"),
    UserModel.find({ role: { $in: BREAK_ADMIN_ROLES }, active: true }).distinct("_id"),
  ]);
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const id of [...open, ...admins] as Types.ObjectId[]) {
    const key = id.toString();
    if (key === exclude.toString() || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

async function broadcastStarted(doc: BreakSessionDoc): Promise<void> {
  const name = doc.userName || doc.userEmail || "An employee";
  const unannounced = doc.source !== "manual";
  const recipients = await activeRecipientIds(doc.userRef);
  await emitNotification({
    recipients,
    type: unannounced ? "break.unannounced.team" : "break.started",
    title: unannounced ? `${name} is away (unannounced)` : `${name} is on break`,
    body: unannounced
      ? "Detected away from the office without pressing Break. Their workstation is locked."
      : "They pressed Break and their workstation is locked until they return.",
    link: { kind: "break", breakId: String(doc._id), employeeRef: String(doc.userRef) },
    dedupeKey: `break:${doc._id}:started`,
    actor: { _id: doc.userRef, name },
  });
  if (unannounced) {
    const admins = await UserModel.find({
      role: { $in: BREAK_ADMIN_ROLES },
      active: true,
    }).distinct("_id");
    await emitNotification({
      recipients: admins,
      type: "break.unannounced",
      title: `${name} stepped away — unannounced break (locked)`,
      body: "Only an admin can unlock them. Open Attendance Dashboard → Locked now.",
      link: { kind: "break", breakId: String(doc._id), employeeRef: String(doc.userRef) },
      dedupeKey: `break:${doc._id}:admin`,
      actor: { _id: doc.userRef, name },
    });
  }
  publish(String(doc.userRef), {
    type: "break:started",
    break: toEvent(doc),
    at: new Date().toISOString(),
  });
}

async function broadcastEnded(doc: BreakSessionDoc): Promise<void> {
  const name = doc.userName || doc.userEmail || "An employee";
  const recipients = await activeRecipientIds(doc.userRef);
  await emitNotification({
    recipients,
    type: "break.ended",
    title: `${name} is back`,
    body:
      doc.endedSource === "admin"
        ? `Unlocked by ${doc.endedByName || "an admin"}.`
        : "They ended their break.",
    link: { kind: "break", breakId: String(doc._id), employeeRef: String(doc.userRef) },
    dedupeKey: `break:${doc._id}:ended`,
    actor: { _id: doc.userRef, name },
  });
  if (doc.endedSource === "admin") {
    await emitNotification({
      recipients: [doc.userRef],
      type: "break.unlocked",
      title: "Your workstation has been unlocked",
      body: `${doc.endedByName || "An admin"} cleared your unannounced break.`,
      link: { kind: "break", breakId: String(doc._id) },
      dedupeKey: `break:${doc._id}:unlocked`,
      excludeActor: false,
    });
  }
  publish(String(doc.userRef), {
    type: "break:ended",
    break: toEvent(doc),
    at: new Date().toISOString(),
  });
}

export interface StartBreakResult {
  doc: BreakSessionDoc;
  created: boolean;
}

/**
 * Start a break for a user. Idempotent — returns the existing open break if
 * there is one. Requires an open check-in session (you can't take a break
 * from work you haven't started). Callers decide the `source`.
 */
export async function startBreak(
  user: UserDoc,
  source: BreakSource,
  extra: { cameraId?: string; reason?: string; startedAt?: Date } = {},
): Promise<StartBreakResult | { error: "NOT_CHECKED_IN" | "EXEMPT" }> {
  if (await isExemptForUser(user)) return { error: "EXEMPT" };
  const existing = await findOpenBreak(user._id);
  if (existing) return { doc: existing, created: false };
  const checkIn = await findOpenCheckIn(user._id);
  if (!checkIn) return { error: "NOT_CHECKED_IN" };

  const startedAt = extra.startedAt || new Date();
  const doc = await BreakSessionModel.create({
    userRef: user._id,
    checkInSessionRef: checkIn._id,
    userName: displayName(user),
    userEmail: user.email,
    shift: user.shift,
    date: officeDate(startedAt),
    startedAt,
    endedAt: null,
    source,
    endedSource: null,
    cameraId: extra.cameraId,
    reason: extra.reason,
  });
  // Presence state is now owned by the break row.
  await PresenceStateModel.updateOne({ userRef: user._id }, { $set: { awaySince: null } });
  await broadcastStarted(doc);
  return { doc, created: true };
}

export async function closeBreak(
  doc: BreakSessionDoc,
  endedSource: BreakEndedSource,
  opts: { endedBy?: UserDoc; reason?: string; at?: Date } = {},
): Promise<BreakSessionDoc> {
  const at = opts.at || new Date();
  doc.endedAt = at;
  doc.endedSource = endedSource;
  doc.durationSeconds = Math.max(
    0,
    Math.round((at.getTime() - doc.startedAt.getTime()) / 1000),
  );
  if (opts.endedBy) {
    doc.endedByRef = opts.endedBy._id;
    doc.endedByName = displayName(opts.endedBy);
  }
  if (opts.reason) doc.reason = opts.reason;
  await doc.save();
  // Whatever the cameras think, the person is back at their desk now.
  await PresenceStateModel.updateOne({ userRef: doc.userRef }, { $set: { awaySince: null } });
  await broadcastEnded(doc);
  return doc;
}

/**
 * Called by the sweep when a PresenceState has been `awaySince` longer than
 * the threshold. Returns the created break, or null when the user is not
 * checked in / exempt / already on a break (in which case awaySince is
 * cleared so the sweep doesn't re-evaluate it every tick).
 */
export async function autoStartPresenceBreak(
  userId: Types.ObjectId,
  cameraId?: string,
): Promise<BreakSessionDoc | null> {
  const user = await UserModel.findById(userId);
  if (!user) {
    await PresenceStateModel.updateOne({ userRef: userId }, { $set: { awaySince: null } });
    return null;
  }
  const result = await startBreak(user, "presence", { cameraId });
  if ("error" in result) {
    await PresenceStateModel.updateOne({ userRef: userId }, { $set: { awaySince: null } });
    return null;
  }
  return result.created ? result.doc : null;
}

/** Reset camera state when the user starts a working session. */
export async function clearPresenceOnCheckIn(userId: Types.ObjectId): Promise<void> {
  await PresenceStateModel.updateOne({ userRef: userId }, { $set: { awaySince: null } });
}

export function unlockModeFor(doc: Pick<BreakSessionDoc, "source">): "otp" | "admin" {
  return isOtpUnlockable(doc) ? "otp" : "admin";
}

export function toObjectId(id: string | Types.ObjectId): Types.ObjectId | null {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}
