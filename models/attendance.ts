import { Schema, model } from "mongoose";
import { UserModel } from "./userModel";
import { attendanceDateFormate, isFormateValid } from "../utils/utils";

const attendanceSchema = new Schema(
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

export const AttendanceModel = model("Attendance", attendanceSchema);
