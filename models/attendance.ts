import { Schema, model, Document } from "mongoose";
import { UserModel } from "./userModel";
import { attendanceDateFormate, isFormateValid } from "../utils/utils";
import { IAttendance } from "../interface/modelInterfaces";

export interface AttendanceDoc extends Omit<IAttendance, '_id' | 'userRef' | 'checkIn' | 'checkOut' | 'createdAt' | 'updatedAt'>, Document {
  _id: Schema.Types.ObjectId;
  userRef: Schema.Types.ObjectId;
  checkIn?: Date;
  checkOut?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<AttendanceDoc>(
  {
    userRef: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },

    date: {
      type: String,
      required: true,
      validate: {
        validator: function (value: string) {
          return isFormateValid(value);
        },
        message: "Date must be in " + attendanceDateFormate + " format.",
      },
    },

    checkIn: { type: Date, default: Date.now },

    checkOut: {
      type: Date,
    },

    status: { type: String, enum: ["Present", "Absent", "Late", "Half-Day"] },
  },
  { timestamps: true }
);

export const AttendanceModel = model<AttendanceDoc>("Attendance", attendanceSchema);
