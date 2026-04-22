import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";

export interface SalarySlipEarnings {
  basic: number;
  hra: number;
  mobileReimbursement: number;
  booksReimbursement: number;
  specialAllowances: number;
  incentives: number;
  total: number;
}

export interface SalarySlipDeductions {
  pf: number;
  tds: number;
  otherDeductions: number;
  lopDeduction: number;
  total: number;
}

export interface SalarySlipLeaveBreakdown {
  paidAccrued: number;
  paidUsed: number;
  paidBalance: number;
  medicalAccrued: number;
  medicalUsed: number;
  medicalBalance: number;
  unpaidDays: number;
  bonusPaid: number;
  bonusMedical: number;
}

export interface SalarySlipDoc extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  year: number;
  month: number;
  employeeName: string;
  employeeId: string;
  designation: string;
  dateOfJoining?: Date;
  country: "IN" | "US";
  currency: "INR" | "USD";
  totalDays: number;
  weekendDays: number;
  holidays: number;
  workingDays: number;
  presentDays: number;
  earnings: SalarySlipEarnings;
  deductions: SalarySlipDeductions;
  leaves: SalarySlipLeaveBreakdown;
  perDayRate: number;
  netPay: number;
  netPayWords: string;
  generatedAt: Date;
  generatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const slipSchema = new Schema<SalarySlipDoc>(
  {
    user: { required: true, type: Schema.Types.ObjectId, ref: UserModel },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    employeeName: { type: String, default: "" },
    employeeId: { type: String, default: "" },
    designation: { type: String, default: "" },
    dateOfJoining: { type: Date },
    country: { type: String, enum: ["IN", "US"], default: "IN" },
    currency: { type: String, enum: ["INR", "USD"], default: "INR" },
    totalDays: { type: Number, default: 0 },
    weekendDays: { type: Number, default: 0 },
    holidays: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    earnings: {
      basic: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      mobileReimbursement: { type: Number, default: 0 },
      booksReimbursement: { type: Number, default: 0 },
      specialAllowances: { type: Number, default: 0 },
      incentives: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    deductions: {
      pf: { type: Number, default: 0 },
      tds: { type: Number, default: 0 },
      otherDeductions: { type: Number, default: 0 },
      lopDeduction: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    leaves: {
      paidAccrued: { type: Number, default: 0 },
      paidUsed: { type: Number, default: 0 },
      paidBalance: { type: Number, default: 0 },
      medicalAccrued: { type: Number, default: 0 },
      medicalUsed: { type: Number, default: 0 },
      medicalBalance: { type: Number, default: 0 },
      unpaidDays: { type: Number, default: 0 },
      bonusPaid: { type: Number, default: 0 },
      bonusMedical: { type: Number, default: 0 },
    },
    perDayRate: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    netPayWords: { type: String, default: "" },
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: Schema.Types.ObjectId, ref: UserModel },
  },
  { timestamps: true },
);

slipSchema.index({ user: 1, year: 1, month: 1 }, { unique: true });
slipSchema.index({ year: 1, month: 1 });

export const SalarySlipModel = model<SalarySlipDoc>(
  "SalarySlip",
  slipSchema,
);
