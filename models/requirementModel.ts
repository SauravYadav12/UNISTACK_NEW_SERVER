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
  },
  {
    timestamps: true,
  }
);

export const RequirementModel = mongoose.model<RequirementDoc>(
  "Requirement",
  requirementSchema
);
