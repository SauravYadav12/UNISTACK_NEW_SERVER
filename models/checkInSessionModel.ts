import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";

/**
 * CheckInSession — the source of truth for the working-hours timer and
 * the super-admin check-in/out log.
 *
 * WHY a dedicated model instead of reusing Attendance.checkIn?
 * The Attendance model's `checkIn` field defaults to `Date.now` on EVERY
 * row it creates — including the Absent rows the leave-approval flow
 * auto-creates. That makes Attendance.checkIn useless as a record of
 * "the employee actually clicked Check In". A session row is created
 * ONLY when the user clicks Check In, so it is an unambiguous log of the
 * click + the timer window.
 *
 * One OPEN session (checkOutAt == null) per user at a time is the
 * invariant the controller enforces. A session is closed by:
 *   - manual   → user clicked Check Out
 *   - logout   → user clicked Logout (logout implies checkout)
 *   - auto     → the 14h sweep closed a session the user forgot to close
 *
 * Salary is NOT read from this model — it stays keyed off Attendance
 * status === Absent. Check-in additionally marks the Attendance row
 * Present, but that is done in the controller, not here.
 */

export const MAX_SESSION_HOURS = 14;
export const MAX_SESSION_MS = MAX_SESSION_HOURS * 60 * 60 * 1000;

export type CheckoutSource = "manual" | "logout" | "auto";

export interface CheckInSessionDoc extends Document {
  _id: Types.ObjectId;
  userRef: Types.ObjectId;
  // Denormalised so the admin log can render name/email without a populate
  // even if the user is later renamed. Snapshot at check-in time.
  userName?: string;
  userEmail?: string;
  // Snapshot of the user's shift (US | India) so the log can render the
  // timestamps in the employee's own timezone.
  shift?: string;
  // `YYYY-MM-DD` in the employee's shift timezone — the grouping key for
  // day/week/month rollups. Indexed alongside userRef.
  date: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  autoCheckout: boolean;
  checkoutSource: CheckoutSource | null;
  // Filled at checkout (or by the sweep). Capped at MAX_SESSION_MS.
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const checkInSessionSchema = new Schema<CheckInSessionDoc>(
  {
    userRef: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
      required: true,
      index: true,
    },
    userName: { type: String },
    userEmail: { type: String },
    shift: { type: String },
    date: { type: String, required: true, index: true },
    checkInAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    autoCheckout: { type: Boolean, default: false },
    checkoutSource: {
      type: String,
      // `null` must be an allowed enum value — an open session has no
      // checkout source yet, and Mongoose validates the default against
      // the enum on create.
      enum: ["manual", "logout", "auto", null],
      default: null,
    },
    durationSeconds: { type: Number, default: null },
  },
  { timestamps: true }
);

// Fast "is this user currently checked in?" lookup — one open row per user.
checkInSessionSchema.index({ userRef: 1, checkOutAt: 1 });
// Log queries scan by date range across users.
checkInSessionSchema.index({ date: 1, userRef: 1 });

export const CheckInSessionModel = model<CheckInSessionDoc>(
  "CheckInSession",
  checkInSessionSchema
);
