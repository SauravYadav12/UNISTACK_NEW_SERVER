import mongoose, { Document, Schema, Types } from "mongoose";
import { UserModel } from "./userModel";
import { IChessLead } from "../interface/modelInterfaces";

export interface ChessLeadDoc
  extends Omit<IChessLead, "_id" | "createdBy" | "createdAt" | "updatedAt">,
    Document {
  _id: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const chessLeadSchema = new Schema<ChessLeadDoc>(
  {
    leadId: { type: String, required: true, unique: true, index: true },
    academyName: { type: String, required: true, trim: true },
    subscriptionDate: { type: String },
    totalIds: { type: Number, min: 0 },
    mobileNumber: { type: String, trim: true },
    stateOrCity: { type: String, trim: true },
    country: { type: String, trim: true },
    countryIso: { type: String, trim: true },
    state: { type: String, trim: true },
    stateIso: { type: String, trim: true },
    city: { type: String, trim: true },
    pricingPerId: { type: Number, min: 0 },
    gstPercent: { type: Number, min: 0, default: 18 },
    status: {
      type: String,
      enum: ["New", "Renewed", "Not renewed", "Not converted"],
      required: true,
      default: "New",
    },
    priority: {
      type: String,
      enum: ["Hot", "Warm", "Cold"],
      required: true,
      default: "Warm",
    },
    reason: { type: String, trim: true },
    nextFollowUpDate: { type: String },
    lastRenewalDate: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: UserModel },
    createdByName: { type: String },
  },
  { timestamps: true },
);

// Common filter combinations — status + priority tiles on the dashboard,
// follow-up rollups keyed on nextFollowUpDate.
chessLeadSchema.index({ status: 1, priority: 1 });
chessLeadSchema.index({ nextFollowUpDate: 1 });

export const ChessLeadModel = mongoose.model<ChessLeadDoc>(
  "ChessLead",
  chessLeadSchema,
);
