import { Schema, model, Document, Types } from "mongoose";

export interface LeaveTypeDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  color?: string;
  paid: boolean;
  defaultAllocationPerYear: number;
  // Per-month accrual cap. Employees can avail up to `monthlyQuota * monthNum`
  // cumulatively by the end of the given month, capped at
  // `defaultAllocationPerYear`. Null/undefined means no monthly cap (UL, ML).
  monthlyQuota?: number | null;
  isUnpaidBucket: boolean;
  /** When true, the ApplyLeave dialog requires at least one attachment
   *  before submit, and the server enforces the same. Used by Medical
   *  Leave so HR has supporting documentation on file. */
  requiresAttachment: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// "Paid Leave" -> "PL", "Casual Leave" -> "CL", "Leave Without Pay" -> "LWP"
export function suggestLeaveCode(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "LV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.map((p) => p[0] || "").join("").toUpperCase();
}

const leaveTypeSchema = new Schema<LeaveTypeDoc>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    description: { type: String, default: "" },
    color: { type: String, default: "" },
    paid: { type: Boolean, default: true },
    defaultAllocationPerYear: { type: Number, default: 0, min: 0 },
    monthlyQuota: { type: Number, default: null, min: 0 },
    isUnpaidBucket: { type: Boolean, default: false },
    requiresAttachment: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Only one type may be marked as the unpaid bucket.
leaveTypeSchema.index(
  { isUnpaidBucket: 1 },
  { unique: true, partialFilterExpression: { isUnpaidBucket: true } },
);

leaveTypeSchema.pre("validate", function (next) {
  if (!this.code && this.name) {
    this.code = suggestLeaveCode(this.name);
  }
  if (this.code) this.code = this.code.toUpperCase();
  next();
});

export const LeaveTypeModel = model<LeaveTypeDoc>("LeaveType", leaveTypeSchema);

// Seeded once on server start if no types exist.
export const DEFAULT_LEAVE_TYPES: Array<Partial<LeaveTypeDoc>> = [
  // Monthly-capped: 1 day/month accrual, carried forward within the year.
  // `monthlyQuota` is the per-user-per-month rate. CL/SL keep 1.5 (legacy
  // policy); PL is 1/mo per the company's current allocation policy.
  // Company policy: 12 paid + 12 medical per year, 1/month each.
  // Carry-forward of unused months stays within the calendar year.
  { name: "Paid Leave", code: "PL", paid: true, defaultAllocationPerYear: 12, monthlyQuota: 1, color: "#EC4599" },
  { name: "Casual Leave", code: "CL", paid: true, defaultAllocationPerYear: 0, monthlyQuota: 1.5, color: "#37B7EA" },
  { name: "Sick Leave", code: "SL", paid: true, defaultAllocationPerYear: 0, monthlyQuota: 1.5, color: "#F59E0B" },
  // ML now mirrors PL: 12/yr, 1/mo accrual. Supporting medical
  // documentation is mandatory on apply.
  { name: "Medical Leave", code: "ML", paid: true, defaultAllocationPerYear: 12, monthlyQuota: 1, requiresAttachment: true, color: "#10B981" },
  // UL is uncapped and always visible.
  { name: "Unpaid Leave", code: "UL", paid: false, defaultAllocationPerYear: 0, monthlyQuota: null, isUnpaidBucket: true, color: "#5E7687" },
];

export async function seedDefaultLeaveTypes(): Promise<number> {
  const count = await LeaveTypeModel.estimatedDocumentCount();
  if (count > 0) return 0;
  const inserted = await LeaveTypeModel.insertMany(DEFAULT_LEAVE_TYPES);
  return inserted.length;
}
