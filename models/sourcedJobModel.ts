import { Schema, model, Document, Types } from "mongoose";

/**
 * SourcedJob — a job pulled from an external source (dedicated Gmail inbox
 * for v1; JSearch / remote feeds / discovered boards later), extracted by
 * Claude into the Requirement shape and held in a REVIEW QUEUE.
 *
 * It is NOT a Requirement yet — a human reviews/edits it on the "IT Job
 * Search" page and clicks Approve, at which point a real Requirement is
 * created (gets a reqID, appears in Requirements). Rejected ones are kept
 * for audit/dedupe but never become requirements.
 *
 * The requirement-shaped fields below mirror RequirementModel exactly so
 * approval is a straight pass-through. `rate / taxType / remote / duration`
 * are arrays to match the Requirement schema (and the extractor output).
 */

export type SourcedJobSource = "email" | "jsearch" | "feed" | "discovered";
export type SourcedJobStatus = "pending" | "approved" | "rejected" | "duplicate";
export type WorkAuth = "usc-gc-ok" | "needs-sponsorship" | "unknown";

export interface SourcedJobDoc extends Document {
  _id: Types.ObjectId;

  // ── Requirement-shaped fields (what Approve copies into a Requirement) ──
  jobTitle?: string;
  jobDescription?: string;
  employementType?: string;
  jobPortalLink?: string; // the source job-post URL (mandatory for contact-less sources)
  reqKeywords?: string;
  recordOwner?: string;
  primaryTech?: string;
  secondaryTech?: string;
  primaryTechStack?: string;
  clientCompany?: string;
  clientWebsite?: string;
  clientAddress?: string;
  clientPerson?: string;
  clientPhone?: string;
  clientEmail?: string;
  primeVendorCompany?: string;
  primeVendorWebsite?: string;
  primeVendorName?: string;
  primeVendorPhone?: string;
  primeVendorEmail?: string;
  vendorCompany?: string;
  vendorWebsite?: string;
  vendorPersonName?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  rate?: string[];
  taxType?: string[];
  remote?: string[];
  duration?: string[];

  // ── Source + pipeline metadata ──
  source: SourcedJobSource;
  sourceName?: string; // e.g. "Dice", the sending domain, "Remotive"
  sourceRef?: string; // email Message-ID / apply URL — dedupe + traceability
  receivedAt: Date;
  rawExcerpt?: string; // trimmed source text, for the reviewer's reference

  // ── Claude classification (why it matched) ──
  is100Remote?: boolean;
  remoteScopeUS?: boolean;
  isTechnical?: boolean;
  workAuth: WorkAuth;
  seniority?: string;
  confidence?: number; // 0..1
  classifierModel?: string;
  hasVendorContact: boolean;

  // ── Review state ──
  dedupeKey: string;
  status: SourcedJobStatus;
  reviewedByRef?: Types.ObjectId;
  reviewedAt?: Date;
  createdRequirementRef?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const sourcedJobSchema = new Schema<SourcedJobDoc>(
  {
    jobTitle: { type: String },
    jobDescription: { type: String },
    employementType: { type: String },
    jobPortalLink: { type: String },
    reqKeywords: { type: String },
    recordOwner: { type: String },
    primaryTech: { type: String },
    secondaryTech: { type: String },
    primaryTechStack: { type: String },
    clientCompany: { type: String },
    clientWebsite: { type: String },
    clientAddress: { type: String },
    clientPerson: { type: String },
    clientPhone: { type: String },
    clientEmail: { type: String },
    primeVendorCompany: { type: String },
    primeVendorWebsite: { type: String },
    primeVendorName: { type: String },
    primeVendorPhone: { type: String },
    primeVendorEmail: { type: String },
    vendorCompany: { type: String },
    vendorWebsite: { type: String },
    vendorPersonName: { type: String },
    vendorPhone: { type: String },
    vendorEmail: { type: String },
    rate: { type: [String], default: undefined },
    taxType: { type: [String], default: undefined },
    remote: { type: [String], default: undefined },
    duration: { type: [String], default: undefined },

    source: {
      type: String,
      enum: ["email", "jsearch", "feed", "discovered"],
      required: true,
    },
    sourceName: { type: String },
    sourceRef: { type: String },
    receivedAt: { type: Date, required: true, default: Date.now },
    rawExcerpt: { type: String },

    is100Remote: { type: Boolean },
    remoteScopeUS: { type: Boolean },
    isTechnical: { type: Boolean },
    workAuth: {
      type: String,
      enum: ["usc-gc-ok", "needs-sponsorship", "unknown"],
      default: "unknown",
    },
    seniority: { type: String },
    confidence: { type: Number },
    classifierModel: { type: String },
    hasVendorContact: { type: Boolean, default: false },

    dedupeKey: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "duplicate"],
      default: "pending",
      index: true,
    },
    reviewedByRef: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    createdRequirementRef: { type: Schema.Types.ObjectId, ref: "Requirement" },
  },
  { timestamps: true }
);

sourcedJobSchema.index({ status: 1, receivedAt: -1 });
sourcedJobSchema.index({ status: 1, hasVendorContact: -1, receivedAt: -1 });
// Fast "have we already processed this email?" lookup (dedupe by Message-ID).
sourcedJobSchema.index({ sourceRef: 1 });

export const SourcedJobModel = model<SourcedJobDoc>(
  "SourcedJob",
  sourcedJobSchema
);
