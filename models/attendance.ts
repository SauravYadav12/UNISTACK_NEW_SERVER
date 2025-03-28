import { Schema, model } from "mongoose";
import User from "./user";

const attendanceSchema = new Schema(
  {
    userRef: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: User,
    },

    date: {
      type: Date,
      default: Date.now,
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
