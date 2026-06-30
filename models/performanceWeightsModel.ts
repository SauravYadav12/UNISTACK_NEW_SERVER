import mongoose, { Document } from "mongoose";

/**
 * Role-scoped performance-scoring weights. One document per role. Audit log
 * records every edit so the team can see the formula's history at any time.
 *
 * Shape is deliberately permissive (string → number map) so we can add new
 * metrics later without migrating the schema — the scoring util picks only
 * the keys it cares about.
 */
export type PerformanceRole = "marketing" | "support";

export interface PerformanceWeightsAuditEntry {
  changedBy?: mongoose.Types.ObjectId;
  changedByName?: string;
  changedAt: Date;
  before: Record<string, number>;
  after: Record<string, number>;
  reason?: string;
}

export interface PerformanceWeightsDoc extends Document {
  _id: mongoose.Types.ObjectId;
  role: PerformanceRole;
  weights: Record<string, number>;
  audit: PerformanceWeightsAuditEntry[];
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt: Date;
  createdAt: Date;
}

const auditSchema = new mongoose.Schema<PerformanceWeightsAuditEntry>(
  {
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedByName: { type: String },
    changedAt: { type: Date, default: Date.now },
    before: { type: mongoose.Schema.Types.Mixed, required: true },
    after: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String },
  },
  { _id: true }
);

const weightsSchema = new mongoose.Schema<PerformanceWeightsDoc>(
  {
    role: {
      type: String,
      enum: ["marketing", "support"],
      required: true,
      unique: true,
    },
    weights: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    audit: { type: [auditSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const PerformanceWeightsModel = mongoose.model<PerformanceWeightsDoc>(
  "PerformanceWeights",
  weightsSchema
);

// ── Defaults — shipped; editable at runtime ────────────────────────────────
// The server rehydrates these on first GET if the collection is empty. Keep
// the keys in sync with `utils/scoring.ts`.

export const DEFAULT_MARKETING_WEIGHTS: Record<string, number> = {
  SUBMISSION_WEIGHT: 2,
  // Completed client interview — the real win. Confirms no longer carry
  // standalone credit; the marketer is paid only when the interview
  // actually happens.
  INTERVIEW_COMPLETED_WEIGHT: 10,
  CONVERSION_BONUS: 0.5,
  STALE_SUBMISSION_PENALTY: 1,
  UNWORKED_REQ_PENALTY: 1,
  // Penalty for a confirmed-then-rotted client interview (no-show,
  // reschedule, dropped). Now pure penalty — no offsetting confirm
  // reward — since the +X-per-confirm line was retired.
  STALE_CONFIRM_PENALTY: 2,
  // Day thresholds — also editable so admins can tune "what counts as stale".
  STALE_SUBMISSION_DAYS: 14,
  UNWORKED_REQ_DAYS: 7,
  STALE_CONFIRM_DAYS: 14,
};

export const DEFAULT_SUPPORT_WEIGHTS: Record<string, number> = {
  REQ_ENTRY_WEIGHT: 1,
  REQ_SUBMITTED_WEIGHT: 3,
  REQ_INTERVIEWED_WEIGHT: 6,
  // Highest-stage credit — parent gets this when any child lands in
  // Project Active / Project Inactive (i.e., the job went live).
  REQ_PROJECT_WEIGHT: 10,
  UNPROGRESSED_REQ_PENALTY: 0.5,
  DUPLICATE_PENALTY: 1,
  UNPROGRESSED_REQ_DAYS: 14,
};

/** Load weights for a role; seed with defaults on first call so every install
 *  starts from a known, documented baseline. */
export async function getWeights(role: PerformanceRole): Promise<PerformanceWeightsDoc> {
  let doc = await PerformanceWeightsModel.findOne({ role });
  if (!doc) {
    doc = await PerformanceWeightsModel.create({
      role,
      weights:
        role === "marketing"
          ? DEFAULT_MARKETING_WEIGHTS
          : DEFAULT_SUPPORT_WEIGHTS,
      audit: [],
    });
  }
  // Self-heal: retire the legacy INTERVIEW_CONFIRM_WEIGHT key on existing
  // marketing docs. The scoring util no longer reads it, but the key
  // would otherwise linger in admin weight editors as a dead row.
  if (
    role === "marketing" &&
    doc.weights &&
    Object.prototype.hasOwnProperty.call(doc.weights, "INTERVIEW_CONFIRM_WEIGHT")
  ) {
    delete (doc.weights as Record<string, number>).INTERVIEW_CONFIRM_WEIGHT;
    doc.markModified("weights");
    await doc.save();
  }
  return doc;
}
