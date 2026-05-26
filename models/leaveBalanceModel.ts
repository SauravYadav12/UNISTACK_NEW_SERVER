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
  /**
   * Per-user override for the LeaveType's `monthlyQuota`. Useful for
   * mid-year joiners — e.g. an employee starting in July gets a prorated
   * `allocated` AND a custom monthly accrual rate so the full balance
   * doesn't unlock immediately under the cumulative-monthly-cap formula.
   *
   * - `null` / missing → use the LeaveType's global `monthlyQuota`
   *   (existing behaviour).
   * - any number       → override the global quota for this user / year /
   *   type only. `0` means "no monthly accrual" (carry-forward only).
   */
  monthlyQuota?: number | null;
  /**
   * 1-indexed month in `year` when this user's monthly accrual begins.
   * Defaults to 1 (January) for legacy / full-year employees.
   *
   * For new joiners on probation, set to `joinMonth + 3` so the
   * cumulative-monthly-cap formula re-anchors. Example: April joiner →
   * `leaveStartMonth = 7`; July is treated as their accrual month #1
   * with `1 * monthlyQuota` available, August is month #2, etc.
   *
   * Decoupled from `dateOfJoining` so future rule changes can override
   * per-balance without touching the user's profile date.
   */
  leaveStartMonth?: number | null;
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
    monthlyQuota: { type: Number, default: null, min: 0 },
    leaveStartMonth: { type: Number, default: null, min: 1, max: 12 },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

leaveBalanceSchema.index({ user: 1, year: 1, leaveType: 1 }, { unique: true });

export const LeaveBalanceModel = model<LeaveBalanceDoc>(
  "LeaveBalance",
  leaveBalanceSchema,
);
