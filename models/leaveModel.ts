import { Schema, model, Document } from "mongoose";
import { UserModel } from "./userModel";
import { isFormateValid, attendanceDateFormate } from "../utils/utils";
import { ILeave } from "../interface/modelInterfaces";

export interface LeaveDoc extends Omit<ILeave, '_id' | 'userRef' | 'respondBy' | 'respondedAt' | 'createdAt' | 'updatedAt'>, Document {
  _id: Schema.Types.ObjectId;
  userRef: Schema.Types.ObjectId;
  respondBy?: Schema.Types.ObjectId;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

enum LeaveType {
  SickLeave = "Sick Leave",
  CasualLeave = "Casual Leave",
  AnnualLeave = "Annual Leave",
  Other = "Other",
}

enum LeaveStatus {
  Pending = "Pending",
  Approved = "Approved",
  Rejected = "Rejected",
}

export enum HalfDayType {
  FirstHalf = "First Half",
  SecondHalf = "Second Half",
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
    type: {
      type: String,
      enum: Object.values(LeaveType),
      default: LeaveType.CasualLeave,
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
    isHalfDay: {
      type: Boolean,
      default: false,
    },
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
  },
  { timestamps: true }
);

export const LeaveModel = model<LeaveDoc>("Leave", leaveSchema);
