import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";

/**
 * PresenceState — the vision service's view of one employee.
 *
 * `awaySince` is set when a `left` event arrives (the employee walked out
 * the exit door) and cleared on `returned`. The break sweep turns a stale
 * `awaySince` (> BREAK_AUTO_LOCK_MINUTES, inside office hours, user checked
 * in, no open break) into a presence-sourced BreakSession and clears it —
 * from then on the break row owns the state.
 */

export type PresenceEventType = "left" | "returned";

export interface PresenceStateDoc extends Document {
  _id: Types.ObjectId;
  userRef: Types.ObjectId;
  awaySince: Date | null;
  lastEventType: PresenceEventType | null;
  lastEventAt: Date | null;
  lastCameraId?: string;
  lastConfidence?: number;
  createdAt: Date;
  updatedAt: Date;
}

const presenceStateSchema = new Schema<PresenceStateDoc>(
  {
    userRef: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
      required: true,
      unique: true,
    },
    awaySince: { type: Date, default: null },
    lastEventType: {
      type: String,
      enum: ["left", "returned", null],
      default: null,
    },
    lastEventAt: { type: Date, default: null },
    lastCameraId: { type: String },
    lastConfidence: { type: Number },
  },
  { timestamps: true },
);

presenceStateSchema.index({ awaySince: 1 });

export const PresenceStateModel = model<PresenceStateDoc>(
  "PresenceState",
  presenceStateSchema,
);
