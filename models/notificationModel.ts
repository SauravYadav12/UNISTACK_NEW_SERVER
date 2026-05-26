import mongoose, { Document, Schema } from "mongoose";

/**
 * Per-recipient notification document. One row per (notification × recipient)
 * so the unread query is a trivial `recipientRef + readAt:null` lookup. Rows
 * self-prune after 15 days via the TTL index on `createdAt` — the user-chosen
 * retention window keeps the collection bounded without a cleanup cron.
 */

export type NotificationLinkKind =
  | "requirement"
  | "interview"
  | "leave"
  | "salary"
  | "project"
  | "timesheet"
  | "filter"
  | "employee-management";

export interface NotificationLink {
  kind: NotificationLinkKind;
  reqID?: string;
  intId?: string;
  leaveId?: string;
  slipMonth?: { year: number; month: number };
  /** For project + timesheet links — what to open on click. */
  projectId?: string;
  /** Approval doc id for timesheet approvals. */
  approvalId?: string;
  /** Approval period (e.g. "2024-05"). */
  periodMonth?: string;
  /** Aggregated proactive-warning targets (list of reqIDs). */
  filterReqIDs?: string[];
  /** For employee-management links — which employee triggered the
   *  notification (probation review, onboarding step, etc.). */
  employeeRef?: string;
}

export interface NotificationActor {
  _id?: mongoose.Types.ObjectId;
  name?: string;
}

export interface NotificationDoc extends Document {
  _id: mongoose.Types.ObjectId;
  recipientRef: mongoose.Types.ObjectId;
  type: string;
  title: string;
  body: string;
  link: NotificationLink;
  dedupeKey?: string;
  readAt?: Date | null;
  actor?: NotificationActor;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationLinkSchema = new Schema<NotificationLink>(
  {
    kind: {
      type: String,
      enum: [
        "requirement",
        "interview",
        "leave",
        "salary",
        "project",
        "timesheet",
        "filter",
      ],
      required: true,
    },
    reqID: { type: String },
    intId: { type: String },
    leaveId: { type: String },
    slipMonth: {
      year: { type: Number },
      month: { type: Number },
    },
    projectId: { type: String },
    approvalId: { type: String },
    periodMonth: { type: String },
    filterReqIDs: { type: [String], default: undefined },
  },
  { _id: false },
);

const NotificationSchema = new Schema<NotificationDoc>(
  {
    recipientRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: NotificationLinkSchema, required: true },
    dedupeKey: { type: String },
    readAt: { type: Date, default: null },
    actor: {
      _id: { type: Schema.Types.ObjectId, ref: "User" },
      name: { type: String },
    },
  },
  { timestamps: true },
);

// List bell items — most recent first, fast unread filter.
NotificationSchema.index({ recipientRef: 1, readAt: 1, createdAt: -1 });
// Cron de-dup lookup (recipient + dedupeKey within last 24h).
NotificationSchema.index({ recipientRef: 1, dedupeKey: 1, createdAt: -1 });
// 15-day TTL — Mongo prunes silently.
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 15 },
);
// Partial unique index — makes duplicate notifications DB-impossible for
// the cron-emitted rows that opt into deduplication via a `dedupeKey`.
// Critical: the `partialFilterExpression` restricts the index to rows
// where `dedupeKey` is a string, so the dominant category of notifications
// (assign / leave / salary / interview events — none of which pass a
// `dedupeKey`) are NEVER constrained by this index. Without the partial
// filter, every notification would need a unique `(recipientRef, null)`
// pair which is nonsensical and would break the system entirely.
//
// Combined with the read-side dedupe check in `emitNotification` (which
// avoids the failed-insert round-trip in the common case), this is
// belt-and-suspenders against the TOCTOU race that caused the original
// duplicate-bell-row bug.
NotificationSchema.index(
  { recipientRef: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
    name: "recipientRef_1_dedupeKey_1_unique",
  },
);

export const NotificationModel = mongoose.model<NotificationDoc>(
  "Notification",
  NotificationSchema,
);
