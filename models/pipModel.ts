import { Schema, model, Document, Types } from "mongoose";
import { PIP_REASONS, PipReason, PIP_DAYS } from "../utils/pip";

/**
 * Performance Improvement Plan — one row per PIP instance (standalone, so a
 * person can have historical PIPs across the Active / Successful / Failed
 * boards). Lifecycle:
 *
 *   draft  → saved but not sent; no dates yet, not tracked.
 *   active → email sent; startDate/endDate set; the scheduler tracks it and
 *            notifies super-admins once endDate elapses.
 *   successful | failed → resolved by a reviewer (terminal).
 *
 * `endDate` is the EFFECTIVE end (moves forward on each extension) and is
 * what the completion scheduler queries; `originalEndDate` is frozen at the
 * initial 30-day mark for reference.
 */

export type PipStatus = "draft" | "active" | "successful" | "failed";

export interface PipExtension {
  days: number;
  at: Date;
  byRef?: Types.ObjectId;
}

export interface PipDoc extends Document {
  _id: Types.ObjectId;

  // Subject employee (denormalized name/email so cards + emails stay
  // readable even if the user record later changes).
  employeeRef: Types.ObjectId;
  employeeName: string;
  employeeEmail: string;

  // Why the employee is on a PIP.
  reasons: PipReason[];
  otherReason?: string;

  // The initiation email the reviewer drafted/reviewed.
  emailSubject: string;
  emailBody: string;

  status: PipStatus;

  // Tracking window — only set once sent.
  startDate?: Date;
  originalEndDate?: Date; // startDate + PIP_DAYS (frozen)
  endDate?: Date; // effective end; moves on extension; scheduler queries this
  durationDays: number; // initial window (default 30)
  extensionDays: number; // cumulative
  extensions: PipExtension[];
  sentAt?: Date;
  // Set when the completion scheduler has notified super-admins for the
  // CURRENT endDate. Cleared on extension so the new window re-notifies.
  completionNotifiedAt?: Date;

  // Resolution.
  resolutionNote?: string;
  resolvedAt?: Date;
  resolvedByRef?: Types.ObjectId;

  createdByRef: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const pipExtensionSchema = new Schema<PipExtension>(
  {
    days: { type: Number, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    byRef: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

const pipSchema = new Schema<PipDoc>(
  {
    employeeRef: { type: Schema.Types.ObjectId, ref: "User", required: true },
    employeeName: { type: String, required: true, trim: true },
    employeeEmail: { type: String, trim: true, default: "" },

    reasons: {
      type: [String],
      enum: PIP_REASONS as unknown as string[],
      default: [],
    },
    otherReason: { type: String, trim: true },

    emailSubject: { type: String, default: "" },
    emailBody: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "active", "successful", "failed"],
      default: "draft",
      index: true,
    },

    startDate: { type: Date },
    originalEndDate: { type: Date },
    endDate: { type: Date },
    durationDays: { type: Number, default: PIP_DAYS },
    extensionDays: { type: Number, default: 0 },
    extensions: { type: [pipExtensionSchema], default: [] },
    sentAt: { type: Date },
    completionNotifiedAt: { type: Date },

    resolutionNote: { type: String, trim: true },
    resolvedAt: { type: Date },
    resolvedByRef: { type: Schema.Types.ObjectId, ref: "User" },

    createdByRef: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Completion scheduler: active PIPs whose effective end has elapsed.
pipSchema.index({ status: 1, endDate: 1 });
// Board listing + per-employee history.
pipSchema.index({ status: 1, createdAt: -1 });
pipSchema.index({ employeeRef: 1, createdAt: -1 });

export const PipModel = model<PipDoc>("Pip", pipSchema);
