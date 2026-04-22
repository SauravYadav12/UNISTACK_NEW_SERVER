import mongoose, { Document } from "mongoose";
import { ProjectModel } from "./projectModel";
import { OrganizationModel } from "./organizationModel";
import { UserModel } from "./userModel";
import { ITimesheetApproval } from "../interface/modelInterfaces";

export interface TimesheetApprovalDoc
  extends Omit<
      ITimesheetApproval,
      | "_id"
      | "projectRef"
      | "organizationRef"
      | "timesheetIds"
      | "requestedBy"
      | "approvedBy"
      | "rejectedBy"
      | "generatedInvoiceRef"
      | "requestedAt"
      | "approvedAt"
      | "rejectedAt"
      | "createdAt"
      | "updatedAt"
    >,
    Document {
  _id: mongoose.Types.ObjectId;
  projectRef: mongoose.Types.ObjectId;
  organizationRef: mongoose.Types.ObjectId;
  timesheetIds: mongoose.Types.ObjectId[];
  requestedBy?: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  rejectedBy?: mongoose.Types.ObjectId;
  generatedInvoiceRef?: mongoose.Types.ObjectId;
  requestedAt?: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new mongoose.Schema<TimesheetApprovalDoc>(
  {
    projectRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ProjectModel,
      required: true,
    },
    projectId: { type: String, required: true },
    organizationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: OrganizationModel,
      required: true,
    },
    periodMonth: { type: String, required: true },
    status: {
      type: String,
      enum: ["Pending", "Requested", "Approved", "Rejected"],
      default: "Pending",
      required: true,
    },
    timesheetIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    totalHoursAtSubmission: { type: Number, min: 0 },

    requestedAt: { type: Date },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: UserModel },
    approvedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: UserModel },
    rejectedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: UserModel },
    rejectionReason: { type: String },

    generatedInvoiceRef: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
  },
  { timestamps: true }
);

approvalSchema.index({ projectRef: 1, periodMonth: 1 }, { unique: true });

export const TimesheetApprovalModel = mongoose.model<TimesheetApprovalDoc>(
  "TimesheetApproval",
  approvalSchema
);
