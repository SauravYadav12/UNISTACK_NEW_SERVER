import { Schema, model } from "mongoose";
import User from "./user";
import { isFormateValid, attendanceDateFormate } from "../utils/utils";

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

enum HalfDayType {
  FirstHalf = "First Half",
  SecondHalf = "Second Half",
}

const dateValidator = {
  validator: function (value: string) {
    return isFormateValid(value);
  },
  message: "Date must be in " + attendanceDateFormate + " format.",
};

const leaveSchema = new Schema({
  userRef: {
    required: true,
    type: Schema.Types.ObjectId,
    ref: User,
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
    ref: User,
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
      return (this as any)?.isHalfDay;
    },
  },
  attachments: [String],
});

export const LeaveModel = model("Leave", leaveSchema);
