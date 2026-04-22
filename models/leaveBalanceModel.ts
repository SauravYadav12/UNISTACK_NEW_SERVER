import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";
import { LeaveTypeModel } from "./leaveTypeModel";

// Legacy constants kept so the salary calc service keeps compiling while we
// migrate. The new system stores per-type `allocated` on LeaveBalance docs
// instead of relying on these numbers.
export const DEFAULT_PAID_LEAVES_PER_YEAR = 10;
export const DEFAULT_MEDICAL_LEAVES_PER_YEAR = 10;
export const PAID_LEAVE_ACCRUAL_PER_MONTH = 1;

export interface LeaveBalanceDoc extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  year: number;
  leaveType: Types.ObjectId;
  allocated: number;
  used: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const leaveBalanceSchema = new Schema<LeaveBalanceDoc>(
  {
    user: { required: true, type: Schema.Types.ObjectId, ref: UserModel },
    year: { type: Number, required: true, min: 2000, max: 3000 },
    leaveType: { required: true, type: Schema.Types.ObjectId, ref: LeaveTypeModel },
    allocated: { type: Number, default: 0, min: 0 },
    used: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

leaveBalanceSchema.index({ user: 1, year: 1, leaveType: 1 }, { unique: true });

export const LeaveBalanceModel = model<LeaveBalanceDoc>(
  "LeaveBalance",
  leaveBalanceSchema,
);
