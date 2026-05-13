import mongoose from "mongoose";
import {
  NotificationActor,
  NotificationLink,
  NotificationModel,
} from "../models/notificationModel";

/**
 * Fire-and-forget notification emitter. Called from controllers (synchronous
 * to the business action) and from the proactive-warning cron. The whole
 * thing is wrapped in try/catch — a notification bug must never break the
 * underlying business operation, so we log and continue.
 *
 * Pass an array of recipient ObjectIds; the function inserts one row per
 * recipient via `insertMany` so a multi-marketer assignment is a single
 * round-trip. Falsy / duplicate recipients are filtered out so callers can
 * pass `[req.assignedToRef, req.reqEnteredByRef].filter(Boolean)` without
 * worrying about self-notifications (we drop the actor automatically).
 */
export interface EmitArgs {
  recipients: Array<mongoose.Types.ObjectId | string | undefined | null>;
  type: string;
  title: string;
  body?: string;
  link: NotificationLink;
  dedupeKey?: string;
  actor?: NotificationActor;
  /**
   * When true (default), don't notify the actor about their own action — they
   * already know they just did it. Set false for events where the actor
   * legitimately wants a confirmation (we leave this off for v1).
   */
  excludeActor?: boolean;
}

function toObjectId(
  x: mongoose.Types.ObjectId | string | undefined | null,
): mongoose.Types.ObjectId | null {
  if (!x) return null;
  if (x instanceof mongoose.Types.ObjectId) return x;
  if (typeof x === "string" && mongoose.Types.ObjectId.isValid(x)) {
    return new mongoose.Types.ObjectId(x);
  }
  return null;
}

export async function emitNotification(args: EmitArgs): Promise<void> {
  try {
    const excludeActor = args.excludeActor ?? true;
    const actorId = args.actor?._id
      ? toObjectId(args.actor._id as mongoose.Types.ObjectId | string)
      : null;

    // Dedupe + filter + drop actor.
    const seen = new Set<string>();
    const recipientIds: mongoose.Types.ObjectId[] = [];
    for (const raw of args.recipients) {
      const id = toObjectId(raw);
      if (!id) continue;
      const key = id.toString();
      if (seen.has(key)) continue;
      if (excludeActor && actorId && actorId.equals(id)) continue;
      seen.add(key);
      recipientIds.push(id);
    }
    if (recipientIds.length === 0) return;

    // Cron de-dup: if a dedupeKey was supplied, skip any recipient who already
    // has a notification with this key in the last 24h.
    let effectiveRecipients = recipientIds;
    if (args.dedupeKey) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await NotificationModel.distinct("recipientRef", {
        recipientRef: { $in: recipientIds },
        dedupeKey: args.dedupeKey,
        createdAt: { $gte: since },
      });
      const existingSet = new Set(existing.map((x) => x.toString()));
      effectiveRecipients = recipientIds.filter(
        (id) => !existingSet.has(id.toString()),
      );
      if (effectiveRecipients.length === 0) return;
    }

    const docs = effectiveRecipients.map((recipientRef) => ({
      recipientRef,
      type: args.type,
      title: args.title,
      body: args.body || "",
      link: args.link,
      dedupeKey: args.dedupeKey,
      readAt: null,
      actor: args.actor,
    }));

    await NotificationModel.insertMany(docs, { ordered: false });
  } catch (err) {
    // Notifications must never break business operations. Log + swallow.
    console.error("[notifications] emit failed:", err);
  }
}
