import { Schema, model, Document, Types } from "mongoose";
import { UserModel } from "./userModel";
import { isFormateValid, attendanceDateFormate } from "../utils/utils";
import { ILeave } from "../interface/modelInterfaces";
import { LeaveTypeModel } from "./leaveTypeModel";

export interface LeaveSplitItem {
  leaveType: Types.ObjectId;
  days: number;
}

export interface LeaveDoc extends Omit<ILeave, '_id' | 'userRef' | 'respondBy' | 'respondedAt' | 'createdAt' | 'updatedAt' | 'leaveType' | 'splitBreakdown' | 'revokedBy' | 'revokedAt'>, Document {
  _id: Schema.Types.ObjectId;
  userRef: Schema.Types.ObjectId;
  respondBy?: Schema.Types.ObjectId;
  respondedAt?: Date;
  leaveType?: Types.ObjectId;
  // When a request exceeds the monthly quota for the chosen type, the
  // overflow is stored here so the admin approval deducts correctly from
  // each bucket. Empty/unset means "deduct everything from leaveType".
  splitBreakdown?: LeaveSplitItem[];
  // Set when HR reverses an Approved leave. Balance is restored,
  // attendance stamps are unmarked, but the row is kept so the audit
  // trail survives. `revokeReason` is HR's free-text note; optional.
  revokedBy?: Schema.Types.ObjectId;
  revokedAt?: Date;
  revokeReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum LeaveType {
  SickLeave = "Sick Leave",
  CasualLeave = "Casual Leave",
  AnnualLeave = "Annual Leave",
  Other = "Other",
}

export  enum LeaveStatus {
  Pending = "Pending",
  Approved = "Approved",
  Rejected = "Rejected",
  // HR reversed an Approved leave — balance restored, attendance
  // unmarked. Employee can then apply for a fresh date. We keep the
  // row (not delete) so the audit trail stays intact.
  Revoked = "Revoked",
}

export enum HalfDayType {
  FirstHalf = "First Half",
  SecondHalf = "Second Half",
}

export enum LeavePaymentCategory {
  Paid = "Paid",
  Unpaid = "Unpaid",
  Medical = "Medical",
}

export const dateValidator = {
  validator: function (value: string) {
    return isFormateValid(value);
  },
  message: "Date must be in " + attendanceDateFormate + " format.",
};

const leaveSchema = new Schema<LeaveDoc>(
  {
    userRef: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },
    name: {
      required: true,
      type: String,
    },
    startDate: {
      type: String,
      required: true,
      validate: dateValidator,
    },
    endDate: {
      type: String,
      required: true,
      validate: dateValidator,
    },
    reason: { type: String, trim: true },
    // Legacy denormalized field — kept in sync with `leaveType.name`
    // at write time (see createLeave / updateLeave). Originally a
    // hardcoded enum {Sick Leave, Casual Leave, Annual Leave, Other};
    // dropped the enum + default once the dynamic LeaveType collection
    // became the source of truth. Without that drop, applying any
    // non-legacy type (Paid Leave, Medical Leave, etc.) fails Mongoose
    // validation with `not a valid enum value`.
    type: {
      type: String,
    },
    status: {
      type: String,
      enum: Object.values(LeaveStatus),
      default: LeaveStatus.Pending,
    },

    respondBy: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },
    respondedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },
    revokedAt: {
      type: Date,
    },
    revokeReason: {
      type: String,
      trim: true,
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
    emailRefIds: [String],
    halfDayType: {
      type: String,
      enum: Object.values(HalfDayType),
      required: function () {
        if ("isHalfDay" in this) {
          return this?.isHalfDay;
        }
        return false;
      },
    },
    attachments: [String],
    paymentCategory: {
      type: String,
      enum: Object.values(LeavePaymentCategory),
    },
    leaveType: {
      type: Schema.Types.ObjectId,
      ref: LeaveTypeModel,
    },
    splitBreakdown: [
      {
        _id: false,
        leaveType: { type: Schema.Types.ObjectId, ref: LeaveTypeModel, required: true },
        days: { type: Number, required: true, min: 0 },
      },
    ],
  },
  { timestamps: true }
);

export const LeaveModel = model<LeaveDoc>("Leave", leaveSchema);
