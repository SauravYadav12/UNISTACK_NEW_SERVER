import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";

export interface SalaryConfigDoc extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  // Monthly CTC the HR entered. Used as the seed for auto-filling earning
  // components (Basic/HRA/Mobile/Books) via the fixed formula.
  ctc: number;
  basic: number;
  hra: number;
  mobileReimbursement: number;
  booksReimbursement: number;
  specialAllowances: number;
  incentives: number;
  pf: number;
  /** Karnataka Professional Tax — standard ₹208 / month for every active
   *  employee. Schema default applies on read for legacy configs that
   *  predate this field. */
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  country: "IN" | "US";
  currency: "INR" | "USD";
  effectiveFrom?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salaryConfigSchema = new Schema<SalaryConfigDoc>(
  {
    user: {
      unique: true,
      required: true,
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },
    ctc: { type: Number, default: 0, min: 0 },
    basic: { type: Number, default: 0, min: 0 },
    hra: { type: Number, default: 0, min: 0 },
    mobileReimbursement: { type: Number, default: 0, min: 0 },
    booksReimbursement: { type: Number, default: 0, min: 0 },
    specialAllowances: { type: Number, default: 0, min: 0 },
    incentives: { type: Number, default: 0, min: 0 },
    pf: { type: Number, default: 0, min: 0 },
    // Standard ₹208/month — schema default so legacy configs without
    // the field still resolve to 208 on read and on slip generation.
    professionalTax: { type: Number, default: 208, min: 0 },
    tds: { type: Number, default: 0, min: 0 },
    otherDeductions: { type: Number, default: 0, min: 0 },
    country: { type: String, enum: ["IN", "US"], default: "IN" },
    currency: { type: String, enum: ["INR", "USD"], default: "INR" },
    effectiveFrom: { type: Date },
  },
  { timestamps: true },
);

export const SalaryConfigModel = model<SalaryConfigDoc>(
  "SalaryConfig",
  salaryConfigSchema,
);
