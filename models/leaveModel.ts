import { Schema, model } from "mongoose";
import User from "./user";

const leaveSchema = new Schema({
  userRef: {
    required: true,
    type: Schema.Types.ObjectId,
    ref: User,
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: String,
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },
});

export const LeaveModel = model("Leave", leaveSchema);
