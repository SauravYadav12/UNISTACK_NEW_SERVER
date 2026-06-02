/**
 * Onboarding candidate — the pre-employee record that drives the HR
 * onboarding flow inside Employee Management → Onboarding.
 *
 * One document per candidate. `stage` is the source of truth for the
 * UI progress visualization and the contextual action panel in the
 * admin drawer (see OnboardingPanel + OnboardingCandidateDrawer in the
 * React repo). Each stage transition is a single endpoint call; the
 * controller validates the current stage before flipping (returns
 * 409 on mismatch so concurrent admin actions can't race).
 *
 * Embedded sub-docs:
 *   - `formData` is populated when the candidate submits the public
 *     onboarding form (mirrors the reference Jotform field set 1:1).
 *   - `offer` is populated when HR generates the offer letter. The
 *     critical detail there is `templateAtSendTime`: we snapshot the
 *     OfferLetterTemplate at send-time so re-rendering an old offer
 *     years later always uses *that* offer's wording, even if HR has
 *     edited the active template since.
 */

import mongoose, { Document, Schema, Types } from "mongoose";
import {
  OnboardingDocKind,
  ONBOARDING_DOC_KINDS,
  OnboardingDocSection,
} from "./onboardingDocTemplateModel";

export type OnboardingStage =
  | "invited"
  | "form-submitted"
  | "info-requested"
  | "bg-check"
  | "bg-check-passed"
  | "offer-sent"
  | "offer-signed"
  | "onboarded"
  | "rejected";

export const ONBOARDING_STAGES: OnboardingStage[] = [
  "invited",
  "form-submitted",
  "info-requested",
  "bg-check",
  "bg-check-passed",
  "offer-sent",
  "offer-signed",
  "onboarded",
  "rejected",
];

// Maps stage → 1..7 progress index used by the UI percent ring. Rejected
// is intentionally not in this list — the UI renders it as a separate
// terminal state, not a step.
export const STAGE_PROGRESS_INDEX: Record<OnboardingStage, number> = {
  invited: 1,
  "form-submitted": 2,
  "info-requested": 2, // visually still at "submitted" — HR is asking for more
  "bg-check": 4,
  "bg-check-passed": 5,
  "offer-sent": 6,
  "offer-signed": 7,
  onboarded: 8,
  rejected: 0,
};
export const ONBOARDING_TOTAL_STEPS = 8;

export interface OnboardingReference {
  name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
}

export interface OnboardingFormData {
  dob?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  referredBy?: string;
  highestDegree?: string;
  collegeName?: string;
  degreeCompletionDate?: string;
  references?: OnboardingReference[];
  documents?: {
    resume?: string;
    passportPhoto?: string;
    panCard?: string;
    addressProof?: string;
    degreeCopy?: string;
    lastThreeSalarySlips?: string[];
  };
  candidateSignatureDataUrl?: string;
  submittedAt?: Date;
}

export interface OnboardingOfferSnapshot {
  name: string;
  position: string;
  startDate: Date;
  annualSalary: number;
  probationMonths: number;
}

export interface OnboardingOfferTemplateSnapshot {
  salutationTemplate: string;
  bodyTemplate: string;
  termsTemplate: string;
  closingTemplate: string;
  signatoryName: string;
  signatoryTitle: string;
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  // Director's signature image (base64 data URL) — snapshotted from
  // the active OfferLetterTemplate at send time so the rendered offer
  // always carries the right signature even after HR rotates it.
  directorSignatureDataUrl?: string;
}

/**
 * Captured at sign-time so the offer doubles as a digitally verifiable
 * record. `signatureMode` distinguishes a hand-drawn canvas signature
 * from a typed cursive signature; the typed name is preserved so the
 * renderer can re-paint it at any size without rasterization loss.
 *
 * `signedFromIp` + `signedFromUserAgent` are server-captured from the
 * request. `signedFromLocation` is opt-in browser geolocation supplied
 * by the candidate (may be absent if denied).
 */
export interface OnboardingSignedLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface OnboardingOffer {
  sentAt?: Date;
  signedAt?: Date;
  snapshot: OnboardingOfferSnapshot;
  templateAtSendTime: OnboardingOfferTemplateSnapshot;
  signatureDataUrl?: string;
  signatureDate?: Date;
  signedFullName?: string;
  // Digital verification metadata. Populated at sign-time only.
  signatureMode?: "drawn" | "typed";
  signatureTypedName?: string;
  signedByEmail?: string;
  signedFromIp?: string;
  signedFromUserAgent?: string;
  signedFromLocation?: OnboardingSignedLocation;
}

/**
 * Captured snapshot of an additional onboarding document template
 * (Employment Agreement / Code of Conduct / NDA / Leave Policy) at
 * the moment the offer letter was sent. The candidate signs against
 * these snapshots — subsequent edits to the live template by
 * super-admin don't retroactively alter an already-sent batch.
 */
export interface OnboardingDocTemplateSnapshot {
  kind: OnboardingDocKind;
  title: string;
  preamble: string;
  sections: OnboardingDocSection[];
  acknowledgment: string;
  signatoryName: string;
  signatoryTitle: string;
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  directorSignatureDataUrl?: string;
}

/**
 * Signed instance of an additional doc. One per kind, appended to
 * `additionalSignedDocuments` as the candidate works through the
 * multi-step signing flow.
 */
export interface OnboardingSignedAdditionalDoc {
  kind: OnboardingDocKind;
  signedAt: Date;
  signatureMode: "drawn" | "typed";
  signatureDataUrl?: string;
  signatureTypedName?: string;
  signedFullName: string;
  signatureDate: Date;
  signedByEmail?: string;
  signedFromIp?: string;
  signedFromUserAgent?: string;
  signedFromLocation?: OnboardingSignedLocation;
}

/**
 * Single entry in the candidate's audit trail. Captures every state
 * transition + admin action so HR (or a future auditor with read-only
 * access) can see who touched what.
 *
 * - `by` is the User._id when the actor is an admin / super-admin /
 *   HR; `null` for actions taken by the candidate themselves via a
 *   public link (form submit, offer sign).
 * - `byName` denormalises the actor's display name at the time of
 *   the action so the log stays readable even if the user is later
 *   deleted or renamed.
 * - `details` is a free-text snippet (rejection reason, info-request
 *   subject, offer snapshot diff, etc.) — small, never sensitive.
 */
export interface OnboardingAuditEntry {
  at: Date;
  by?: Types.ObjectId | null;
  byName: string;
  action: string;
  details?: string;
}

export interface OnboardingCandidateDoc extends Document {
  _id: Types.ObjectId;
  candId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  position: string;
  proposedStartDate: Date;
  proposedAnnualSalary: number;
  probationMonths: number;
  stage: OnboardingStage;
  rejectionReason?: string;
  formData?: OnboardingFormData;
  bgCheckStartedAt?: Date;
  bgCheckCompletedAt?: Date;
  offer?: OnboardingOffer;
  // Snapshots of the four additional doc templates captured at
  // offer-send time so the candidate signs the same wording HR
  // approved at send-off, regardless of subsequent edits.
  additionalDocSnapshots?: OnboardingDocTemplateSnapshot[];
  // The candidate's signed copies of the four additional docs. Built
  // up across the multi-step signing flow. When this array has all
  // four kinds present, stage flips to `onboarded`.
  additionalSignedDocuments?: OnboardingSignedAdditionalDoc[];
  invitedBy: Types.ObjectId;
  auditLog: OnboardingAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const referenceSchema = new Schema<OnboardingReference>(
  {
    name: { type: String, trim: true },
    relationship: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
  },
  { _id: false },
);

const documentsSchema = new Schema(
  {
    resume: { type: String },
    passportPhoto: { type: String },
    panCard: { type: String },
    addressProof: { type: String },
    degreeCopy: { type: String },
    lastThreeSalarySlips: { type: [String], default: [] },
  },
  { _id: false },
);

const formDataSchema = new Schema<OnboardingFormData>(
  {
    dob: { type: String },
    address1: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String },
    country: { type: String },
    referredBy: { type: String },
    highestDegree: { type: String },
    collegeName: { type: String },
    degreeCompletionDate: { type: String },
    references: { type: [referenceSchema], default: [] },
    documents: { type: documentsSchema, default: () => ({}) },
    candidateSignatureDataUrl: { type: String },
    submittedAt: { type: Date },
  },
  { _id: false },
);

const offerSnapshotSchema = new Schema<OnboardingOfferSnapshot>(
  {
    name: { type: String, required: true },
    position: { type: String, required: true },
    startDate: { type: Date, required: true },
    annualSalary: { type: Number, required: true },
    probationMonths: { type: Number, required: true },
  },
  { _id: false },
);

const templateSnapshotSchema = new Schema<OnboardingOfferTemplateSnapshot>(
  {
    salutationTemplate: { type: String, required: true },
    bodyTemplate: { type: String, required: true },
    termsTemplate: { type: String, required: true },
    closingTemplate: { type: String, required: true },
    signatoryName: { type: String, required: true },
    signatoryTitle: { type: String, required: true },
    companyName: { type: String, required: true },
    companyAddress: { type: String, required: true },
    companyEmail: { type: String, required: true },
    companyWebsite: { type: String, required: true },
    directorSignatureDataUrl: { type: String },
  },
  { _id: false },
);

const signedLocationSchema = new Schema<OnboardingSignedLocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number },
  },
  { _id: false },
);

const auditEntrySchema = new Schema<OnboardingAuditEntry>(
  {
    at: { type: Date, required: true, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, required: true },
    action: { type: String, required: true },
    details: { type: String },
  },
  { _id: false },
);

const docSectionSchema = new Schema<OnboardingDocSection>(
  {
    heading: { type: String, required: true },
    body: { type: String, required: true },
  },
  { _id: false },
);

const docTemplateSnapshotSchema = new Schema<OnboardingDocTemplateSnapshot>(
  {
    kind: { type: String, required: true, enum: ONBOARDING_DOC_KINDS },
    title: { type: String, required: true },
    preamble: { type: String, default: "" },
    sections: { type: [docSectionSchema], default: [] },
    acknowledgment: { type: String, default: "" },
    signatoryName: { type: String, required: true },
    signatoryTitle: { type: String, required: true },
    companyName: { type: String, required: true },
    companyAddress: { type: String, required: true },
    companyEmail: { type: String, required: true },
    companyWebsite: { type: String, required: true },
    directorSignatureDataUrl: { type: String },
  },
  { _id: false },
);

const signedAdditionalDocSchema = new Schema<OnboardingSignedAdditionalDoc>(
  {
    kind: { type: String, required: true, enum: ONBOARDING_DOC_KINDS },
    signedAt: { type: Date, required: true, default: Date.now },
    signatureMode: { type: String, required: true, enum: ["drawn", "typed"] },
    signatureDataUrl: { type: String },
    signatureTypedName: { type: String },
    signedFullName: { type: String, required: true },
    signatureDate: { type: Date, required: true },
    signedByEmail: { type: String },
    signedFromIp: { type: String },
    signedFromUserAgent: { type: String },
    signedFromLocation: { type: signedLocationSchema },
  },
  { _id: false },
);

const offerSchema = new Schema<OnboardingOffer>(
  {
    sentAt: { type: Date },
    signedAt: { type: Date },
    snapshot: { type: offerSnapshotSchema, required: true },
    templateAtSendTime: { type: templateSnapshotSchema, required: true },
    signatureDataUrl: { type: String },
    signatureDate: { type: Date },
    signedFullName: { type: String },
    signatureMode: { type: String, enum: ["drawn", "typed"] },
    signatureTypedName: { type: String },
    signedByEmail: { type: String },
    signedFromIp: { type: String },
    signedFromUserAgent: { type: String },
    signedFromLocation: { type: signedLocationSchema },
  },
  { _id: false },
);

const onboardingCandidateSchema = new Schema<OnboardingCandidateDoc>(
  {
    candId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    position: { type: String, required: true, trim: true },
    proposedStartDate: { type: Date, required: true },
    proposedAnnualSalary: { type: Number, required: true },
    probationMonths: { type: Number, required: true, default: 3 },
    stage: {
      type: String,
      required: true,
      enum: ONBOARDING_STAGES,
      default: "invited",
    },
    rejectionReason: { type: String, trim: true },
    formData: { type: formDataSchema },
    bgCheckStartedAt: { type: Date },
    bgCheckCompletedAt: { type: Date },
    offer: { type: offerSchema },
    additionalDocSnapshots: {
      type: [docTemplateSnapshotSchema],
      default: undefined,
    },
    additionalSignedDocuments: {
      type: [signedAdditionalDocSchema],
      default: undefined,
    },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    auditLog: { type: [auditEntrySchema], default: [] },
  },
  { timestamps: true },
);

onboardingCandidateSchema.index({ stage: 1, createdAt: -1 });
onboardingCandidateSchema.index({ email: 1 });

export const OnboardingCandidateModel = mongoose.model<OnboardingCandidateDoc>(
  "OnboardingCandidate",
  onboardingCandidateSchema,
);
