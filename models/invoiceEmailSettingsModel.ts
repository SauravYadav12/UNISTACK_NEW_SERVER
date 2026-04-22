import mongoose, { Document } from "mongoose";
import { UserModel } from "./userModel";
import { IEmailTemplateBlock, IInvoiceEmailSettings } from "../interface/modelInterfaces";

export interface InvoiceEmailSettingsDoc
  extends Omit<
      IInvoiceEmailSettings,
      "_id" | "updatedAt" | "updatedBy"
    >,
    Document {
  _id: mongoose.Types.ObjectId;
  updatedAt: Date;
  updatedBy?: mongoose.Types.ObjectId;
}

const templateBlockSchema = new mongoose.Schema<IEmailTemplateBlock>(
  {
    subject: { type: String, required: true },
    heading: { type: String, required: true },
    bodyLead: { type: String, required: true },
    bodyDetails: { type: String, required: true },
    signOff: { type: String, required: true },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema<InvoiceEmailSettingsDoc>(
  {
    timesheetApprovalRequest: { type: templateBlockSchema, required: true },
    raised: { type: templateBlockSchema, required: true },
    due: { type: templateBlockSchema, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: UserModel },
  },
  { timestamps: true }
);

export const InvoiceEmailSettingsModel = mongoose.model<InvoiceEmailSettingsDoc>(
  "InvoiceEmailSettings",
  settingsSchema
);

const DEFAULT_APPROVAL: IEmailTemplateBlock = {
  subject: "Timesheet approval request — {{projectId}} ({{periodMonth}})",
  heading: "Approve this month's timesheets",
  bodyLead:
    "{{requestedBy}} has submitted the timesheets for {{projectId}} ({{organizationName}}) for the month of {{periodMonth}}.",
  bodyDetails:
    "Total hours for the month: {{totalHours}} h. Please review and approve so the invoice can be generated.",
  signOff: "— Unicodez billing",
};

const DEFAULT_RAISED: IEmailTemplateBlock = {
  subject: "Invoice {{invoiceNumber}} — {{organizationName}}",
  heading: "New invoice from {{organizationName}}",
  bodyLead:
    "Please find attached invoice {{invoiceNumber}} for {{projectId}} covering {{periodMonth}}.",
  bodyDetails:
    "Total: {{currency}} {{total}}. Issue date: {{issueDate}}. Due date: {{dueDate}}.",
  signOff: "Thank you,\n{{organizationName}}",
};

const DEFAULT_DUE: IEmailTemplateBlock = {
  subject: "[Payment due] {{invoiceNumber}} — {{clientCompany}}",
  heading: "Invoice {{invoiceNumber}} is now overdue",
  bodyLead:
    "Invoice {{invoiceNumber}} for {{projectId}} ({{organizationName}}) is {{daysOverdue}} day(s) past due.",
  bodyDetails:
    "Total due: {{currency}} {{total}}. Issue date: {{issueDate}}. Due date: {{dueDate}}. Please follow up with the client.",
  signOff: "— Unicodez billing (automated alert)",
};

/** Fetch the singleton; create with sensible defaults on first call. */
export async function getInvoiceEmailSettings() {
  const existing = await InvoiceEmailSettingsModel.findOne();
  if (existing) return existing;
  return InvoiceEmailSettingsModel.create({
    timesheetApprovalRequest: DEFAULT_APPROVAL,
    raised: DEFAULT_RAISED,
    due: DEFAULT_DUE,
  });
}
