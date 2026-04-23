import mongoose, { Document } from "mongoose";
import { RequirementModel } from "./requirementModel";
import { OrganizationModel } from "./organizationModel";
import { IProject } from "../interface/modelInterfaces";

export interface ProjectDoc
  extends Omit<
      IProject,
      "_id" | "requirementRef" | "organizationRef" | "createdAt" | "updatedAt"
    >,
    Document {
  _id: mongoose.Types.ObjectId;
  requirementRef?: mongoose.Types.ObjectId;
  organizationRef?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const additionalDetailSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: String, default: "" },
    addedBy: { type: String },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const contractSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["client", "vendor", "primeVendor", "other"],
      required: true,
    },
    label: { type: String },
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    sizeBytes: { type: Number },
    uploadedBy: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Each documentation step: the status + optional completion metadata.
const docStepSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["Pending", "Done"],
      default: "Pending",
      required: true,
    },
    completedOn: { type: Date },
    notes: { type: String },
    attachmentUrl: { type: String },
  },
  { _id: false }
);

const documentationSchema = new mongoose.Schema(
  {
    bgc: { type: docStepSchema, default: () => ({ status: "Pending" }) },
    contractSigned: { type: docStepSchema, default: () => ({ status: "Pending" }) },
    paymentTermsAccepted: { type: docStepSchema, default: () => ({ status: "Pending" }) },
    onboarding: { type: docStepSchema, default: () => ({ status: "Pending" }) },
    extraNotes: { type: String },
  },
  { _id: false }
);

const paymentTermsSchema = new mongoose.Schema(
  {
    preset: {
      type: String,
      enum: ["Net 15", "Net 30", "Net 45", "Net 60", "Custom"],
      default: "Net 30",
      required: true,
    },
    days: { type: Number, default: 30, min: 0, required: true },
  },
  { _id: false }
);

const invoiceRecipientsSchema = new mongoose.Schema(
  {
    client: { type: Boolean, default: true },
    vendor: { type: Boolean, default: false },
    primeVendor: { type: Boolean, default: false },
    customEmails: { type: [String], default: [] },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema<ProjectDoc>(
  {
    projectId: { type: String, unique: true, required: true },
    reqID: { type: String, unique: true, required: true },
    requirementRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: RequirementModel,
    },

    // Organization
    organizationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: OrganizationModel,
      // Not `required: true` to avoid breaking legacy rows; controller enforces
      // on create. We index either way for fast org-tab filtering.
      index: true,
    },
    organizationName: { type: String },
    organizationShortCode: { type: String },
    organizationEIN: { type: String },
    organizationLogoUrl: { type: String },
    organizationAddress: { type: String },
    organizationEmail: { type: String },
    organizationWebsite: { type: String },

    // Seeded snapshot
    jobTitle: { type: String },
    consultant: { type: String },
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
    // New — required when the admin wants the invoice's Bill-To to show a
    // prime-vendor mailing address. Kept separate from clientAddress so the
    // three parties' postal details don't step on each other.
    primeVendorAddress: { type: String },
    vendorCompany: { type: String },
    vendorWebsite: { type: String },
    vendorPersonName: { type: String },
    vendorPhone: { type: String },
    vendorEmail: { type: String },
    vendorAddress: { type: String },
    rate: { type: Array },
    taxType: { type: Array },
    duration: { type: Array },

    // Which party the invoice is billed to. Drives which company + address
    // is rendered in the Bill-To card on InvoicePreview. Defaults to Client
    // for backward compatibility with existing projects.
    billToCustomer: {
      type: String,
      enum: ["Client", "Vendor", "Prime Vendor"],
      default: "Client",
    },

    // Project-owned
    status: {
      type: String,
      enum: ["Active", "On Hold", "Ended", "Terminated"],
      default: "Active",
      required: true,
    },
    startDate: { type: String },
    endDate: { type: String },
    notes: { type: String },

    // Billing metadata
    billingUnit: {
      type: String,
      enum: ["hourly"],
      default: "hourly",
    },
    paymentTerms: {
      type: paymentTermsSchema,
      default: () => ({ preset: "Net 30", days: 30 }),
    },
    taxPercent: { type: Number, default: 0, min: 0 },
    invoiceRecipients: {
      type: invoiceRecipientsSchema,
      default: () => ({
        client: true,
        vendor: false,
        primeVendor: false,
        customEmails: [],
      }),
    },
    documentation: {
      type: documentationSchema,
      default: () => ({}),
    },

    additionalDetails: { type: [additionalDetailSchema], default: [] },
    contracts: { type: [contractSchema], default: [] },

    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

export const ProjectModel = mongoose.model<ProjectDoc>(
  "Project",
  projectSchema
);

export type { IProject };
