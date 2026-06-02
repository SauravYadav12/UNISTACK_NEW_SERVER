import mongoose, { Document } from "mongoose";
import { UserModel } from "./userModel";
import { ConsultantModel } from "./consultantModel";
import { IRequirement } from "../interface/modelInterfaces";

export interface RequirementDoc extends Omit<IRequirement, '_id' | 'appliedForRef' | 'assignedToRef' | 'reqEnteredByRef' | 'createdAt' | 'updatedAt'>, Document {
  _id: mongoose.Types.ObjectId;
  appliedForRef?: mongoose.Types.ObjectId;
  assignedToRef?: mongoose.Types.ObjectId;
  reqEnteredByRef: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  // ── Performance event timestamps (monotonic scoring) ──
  // Stamped ONCE when the corresponding status milestone is first crossed,
  // never overwritten. Scoring filters leaderboard windows by these
  // timestamps so a point awarded in May stays in May's leaderboard even
  // if the req later moves further forward.
  _perfSubmittedAt?: Date;
  _perfInterviewedAt?: Date;
  _perfProjectActiveAt?: Date;
  _perfProjectInactiveAt?: Date;
  // ── Penalty timestamps — set by the daily scheduler when a threshold is
  //    first crossed. Never unset, so penalties stay locked in for the
  //    period in which they fired even after the marketer/support
  //    remediates.
  _perfStaleSubmissionFiredAt?: Date;
  _perfUnworkedPenaltyFiredAt?: Date;
  _perfUnprogressedPenaltyFiredAt?: Date;
}

const requirementSchema = new mongoose.Schema<RequirementDoc>(
  {
    reqID: {
      type: String,
      unique: true,
      required: true,
    },
    reqStatus: {
      type: String,
    },
    nextStep: {
      type: String,
    },
    appliedFor: {
      type: String,
    },
    appliedForRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ConsultantModel,
    },
    assignedTo: {
      type: String,
    },
    assignedToRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: UserModel,
      index: true,
    },
    resume: {
      type: String,
    },
    resumeUpload: {
      type: String,
    },
    rate: {
      type: Array,
    },
    taxType: {
      type: Array,
    },
    remote: {
      type: Array,
    },
    duration: {
      type: Array,
    },
    mComment: {
      type: Array,
    },
    clientCompany: {
      type: String,
    },
    clientWebsite: {
      type: String,
    },
    clientAddress: {
      type: String,
    },
    clientPerson: {
      type: String,
    },
    clientPhone: {
      type: String,
    },
    clientEmail: {
      type: String,
    },
    primeVendorCompany: {
      type: String,
    },
    primeVendorWebsite: {
      type: String,
    },
    primeVendorName: {
      type: String,
    },
    primeVendorPhone: {
      type: String,
    },
    primeVendorEmail: {
      type: String,
    },
    vendorCompany: {
      type: String,
    },
    vendorWebsite: {
      type: String,
    },
    vendorPersonName: {
      type: String,
    },
    vendorPhone: {
      type: String,
    },
    vendorEmail: {
      type: String,
    },
    reqEnteredDate: {
      type: String,
    },
    gotReqFrom: {
      type: String,
    },
    gotOnResume: {
      type: String,
    },
    jobTitle: {
      type: String,
    },
    employementType: {
      type: String,
    },
    jobPortalLink: {
      type: String,
    },
    reqEnteredBy: {
      type: String,
    },
    reqEnteredByRef: {
      required: true,
      type: mongoose.Schema.Types.ObjectId,
      ref: UserModel,
      index: true,
    },
    reqKeywords: {
      type: String,
    },
    jobDescription: {
      type: String,
    },
    recordOwner: {
      type: String,
    },
    primaryTech: {
      type: String,
    },
    secondaryTech: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
    interviews: {
      type: Array,
    },
    primaryTechStack: {
      type: String,
    },
    isDuplicate: {
      type: String,
    },
    duplicateWith: {
      type: String,
    },
    // Multi-assign nesting: a child requirement is spawned for each
    // marketer assigned to the same parent req. Parents / legacy standalone
    // rows leave both fields empty.
    parentReqID: {
      type: String,
      index: true,
    },
    childSuffix: {
      type: String,
    },
    // Star colour — a cycle-on-click flag any team member can toggle
    // on a parent record to mark priority / mood / "needs attention"
    // (semantics is up to the team). Defaults to 'none' (transparent
    // outline). Children inherit nothing — only parents carry this.
    // The list endpoint accepts `?starColor=X` to filter.
    starColor: {
      type: String,
      enum: ["none", "green", "yellow", "orange"],
      default: "none",
      index: true,
    },
    // ── Performance event timestamps (see comment in RequirementDoc above) ──
    _perfSubmittedAt: { type: Date },
    _perfInterviewedAt: { type: Date },
    _perfProjectActiveAt: { type: Date },
    _perfProjectInactiveAt: { type: Date },
    _perfStaleSubmissionFiredAt: { type: Date },
    _perfUnworkedPenaltyFiredAt: { type: Date },
    _perfUnprogressedPenaltyFiredAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

export const RequirementModel = mongoose.model<RequirementDoc>(
  "Requirement",
  requirementSchema
);
