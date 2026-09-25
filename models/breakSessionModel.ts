import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";

/**
 * BreakSession — one row per break, the source of truth for the lock screen.
 *
 * Invariant: at most ONE open row (endedAt == null) per user. While a row is
 * open the client renders the full-screen lock and the server refuses
 * checkout. A break is closed ONLY by:
 *   - otp    → the employee entered the emailed access code (manual breaks)
 *   - admin  → an admin/HR force-ended it (the only way out of a presence
 *              break, i.e. an unannounced absence detected by the cameras)
 * Nothing else closes a break: not checkout, not logout, not the 14h
 * check-in sweep, not token expiry. That is the whole point of the lock.
 */

export type BreakSource = "manual" | "presence" | "idle";
export type BreakEndedSource = "otp" | "admin";

export interface BreakSessionDoc extends Document {
  _id: Types.ObjectId;
  userRef: Types.ObjectId;
  checkInSessionRef?: Types.ObjectId | null;
  userName?: string;
  userEmail?: string;
  shift?: string;
  /** `YYYY-MM-DD` in the OFFICE timezone (America/New_York). */
  date: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  source: BreakSource;
  endedSource: BreakEndedSource | null;
  endedByRef?: Types.ObjectId | null;
  endedByName?: string;
  reason?: string;
  cameraId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const breakSessionSchema = new Schema<BreakSessionDoc>(
  {
    userRef: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
      required: true,
      index: true,
    },
    checkInSessionRef: { type: Schema.Types.ObjectId, default: null },
    userName: { type: String },
    userEmail: { type: String },
    shift: { type: String },
    date: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: null },
    source: {
      type: String,
      enum: ["manual", "presence", "idle"],
      required: true,
    },
    endedSource: {
      type: String,
      enum: ["otp", "admin", null],
      default: null,
    },
    endedByRef: { type: Schema.Types.ObjectId, ref: UserModel, default: null },
    endedByName: { type: String },
    reason: { type: String },
    cameraId: { type: String },
  },
  { timestamps: true },
);

// "Is this user on a break right now?" — one open row per user.
breakSessionSchema.index({ userRef: 1, endedAt: 1 });
// Day/week/month logs.
breakSessionSchema.index({ date: 1, userRef: 1 });
// Unannounced-break reporting.
breakSessionSchema.index({ date: 1, source: 1 });

/**
 * Only a manual break can be ended by the employee with an OTP. Presence
 * (camera-detected) and idle breaks need an admin. Keep this rule in one
 * place — controller, client `unlockMode` and tests all derive from it.
 */
export function isOtpUnlockable(doc: Pick<BreakSessionDoc, "source">): boolean {
  return doc.source === "manual";
}

export const BreakSessionModel = model<BreakSessionDoc>(
  "BreakSession",
  breakSessionSchema,
);
