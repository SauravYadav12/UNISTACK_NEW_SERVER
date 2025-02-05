const mongoose = require("mongoose");
const User = require("./user");
const requirementSchema = new mongoose.Schema(
  {
    reqID: {
      type: String,
      unique: true,
      default: () => `REQ-${new Date().getTime()}`,
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
    assignedTo: {
      type: String,
    },
    assignedToRef: {
      required: true,
      type: mongoose.Schema.Types.ObjectId,
      ref: User,
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
      ref: User,
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
  },
  {
    timestamps: true,
  }
);

const Requirement = mongoose.model("Requirement", requirementSchema);

module.exports = Requirement;
