import mongoose, { Document } from "mongoose";
import { ProjectModel } from "./projectModel";
import { OrganizationModel } from "./organizationModel";
import { TimesheetApprovalModel } from "./timesheetApprovalModel";
import { IInvoice, IInvoiceLineItem } from "../interface/modelInterfaces";
import { rebuildTotals } from "../utils/billingMath";

export interface InvoiceDoc
  extends Omit<
      IInvoice,
      | "_id"
      | "projectRef"
      | "organizationRef"
      | "approvalRef"
      | "emailedAt"
      | "dueNotifiedAt"
      | "createdAt"
      | "updatedAt"
    >,
    Document {
  _id: mongoose.Types.ObjectId;
  projectRef: mongoose.Types.ObjectId;
  organizationRef: mongoose.Types.ObjectId;
  approvalRef: mongoose.Types.ObjectId;
  emailedAt?: Date;
  dueNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new mongoose.Schema<IInvoiceLineItem>(
  {
    description: { type: String, required: true },
    hours: { type: Number, min: 0 },
    rate: { type: Number, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema<InvoiceDoc>(
  {
    invoiceNumber: { type: String, required: true, unique: true },
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
    organizationName: { type: String, required: true },
    periodMonth: { type: String, required: true },

    lineItems: { type: [lineItemSchema], default: [] },
    subtotal: { type: Number, required: true, default: 0, min: 0 },
    taxLabel: { type: String },
    taxPercent: { type: Number, required: true, default: 0, min: 0 },
    taxAmount: { type: Number, required: true, default: 0, min: 0 },
    total: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true },

    status: {
      type: String,
      enum: ["Draft", "Raised", "Paid", "Due"],
      default: "Draft",
      required: true,
    },
    issueDate: { type: String },
    dueDate: { type: String },
    paidOn: { type: String },
    paymentReference: { type: String },
    paymentNotes: { type: String },

    emailedTo: { type: [String], default: [] },
    emailedAt: { type: Date },
    dueNotifiedAt: { type: Date },

    pdfUrl: { type: String },
    notes: { type: String },

    approvalRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: TimesheetApprovalModel,
      required: true,
    },

    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

invoiceSchema.index({ projectRef: 1, periodMonth: 1 }, { unique: true });
invoiceSchema.index({ status: 1, dueDate: 1 }); // scheduler hot path

// Source-of-truth: subtotal / taxAmount / total are re-derived from line items
// before every save so the stored doc is always arithmetically consistent.
invoiceSchema.pre("save", function recomputeTotals(next) {
  const totals = rebuildTotals(
    (this.lineItems as IInvoiceLineItem[]) || [],
    this.taxPercent || 0
  );
  this.subtotal = totals.subtotal;
  this.taxAmount = totals.taxAmount;
  this.total = totals.total;

  // Invariants the plan called out:
  if (this.status === "Raised" && (!this.issueDate || !this.dueDate)) {
    return next(new Error("Raised invoice requires issueDate and dueDate"));
  }
  if (this.status === "Paid" && !this.paidOn) {
    return next(new Error("Paid invoice requires paidOn"));
  }
  next();
});

export const InvoiceModel = mongoose.model<InvoiceDoc>("Invoice", invoiceSchema);
