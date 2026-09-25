import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";
import ENV_VARS from "../config/env.config";

/**
 * UnidentifiedEvent — a door crossing the vision service could not attribute
 * to an enrolled employee (face hidden, mask, hood, low confidence, too far).
 * The service uploads ONE snapshot with a timestamp overlay; admins review it
 * and either assign it to an employee (which synthesises the matching
 * presence event), mark it as a visitor, or dismiss it.
 *
 * Rows expire after UNIDENTIFIED_RETENTION_DAYS (default 30). The matching
 * S3 lifecycle rule for `presence/unidentified/` is configured on the bucket.
 */

export type UnidentifiedReason = "no_face" | "low_confidence" | "occluded";
export type UnidentifiedResolution =
  | "pending"
  | "assigned"
  | "visitor"
  | "dismissed";

export interface UnidentifiedEventDoc extends Document {
  _id: Types.ObjectId;
  at: Date;
  cameraId: string;
  direction: "in" | "out";
  reason: UnidentifiedReason;
  imageUrl: string;
  imageKey: string;
  resolution: UnidentifiedResolution;
  reviewedByRef?: Types.ObjectId | null;
  reviewedByName?: string;
  reviewedAt?: Date | null;
  resolvedUserRef?: Types.ObjectId | null;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const retentionDays = Number(ENV_VARS.UNIDENTIFIED_RETENTION_DAYS) || 30;

const unidentifiedEventSchema = new Schema<UnidentifiedEventDoc>(
  {
    at: { type: Date, required: true },
    cameraId: { type: String, required: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    reason: {
      type: String,
      enum: ["no_face", "low_confidence", "occluded"],
      required: true,
    },
    imageUrl: { type: String, required: true },
    imageKey: { type: String, required: true },
    resolution: {
      type: String,
      enum: ["pending", "assigned", "visitor", "dismissed"],
      default: "pending",
      index: true,
    },
    reviewedByRef: { type: Schema.Types.ObjectId, ref: UserModel, default: null },
    reviewedByName: { type: String },
    reviewedAt: { type: Date, default: null },
    resolvedUserRef: { type: Schema.Types.ObjectId, ref: UserModel, default: null },
    note: { type: String },
  },
  { timestamps: true },
);

unidentifiedEventSchema.index({ resolution: 1, at: -1 });
unidentifiedEventSchema.index(
  { at: 1 },
  { expireAfterSeconds: retentionDays * 24 * 60 * 60 },
);

export const UnidentifiedEventModel = model<UnidentifiedEventDoc>(
  "UnidentifiedEvent",
  unidentifiedEventSchema,
);
