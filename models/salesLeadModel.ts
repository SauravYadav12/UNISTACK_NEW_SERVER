import { Schema, model, Document } from "mongoose";
import { SalesLead } from "../interface/salesLead";
import { UserModel } from "./userModel";
import mongoose from "mongoose";
import { ISalesLeadComment } from "../interface/modelInterfaces";

export interface SalesLeadDoc extends Omit<SalesLead, '_id' | 'assignedToRef'>, Document {
  _id: mongoose.Types.ObjectId;
  assignedToRef?: mongoose.Types.ObjectId;
}

export interface SalesLeadCommentDoc extends Omit<ISalesLeadComment, '_id' | 'commentBy' | 'date'>, Document {
  _id: mongoose.Types.ObjectId;
  commentBy: mongoose.Types.ObjectId;
  date?: Date;
}

export const commentSchema = new Schema<SalesLeadCommentDoc>({
  name: { type: String, required: true },
  commentBy: { type: Schema.Types.ObjectId, ref: UserModel, required: true },
  comment: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

const salesLeadSchema = new Schema<SalesLeadDoc>(
  {
    firstName: {
      type: String,
      default: "",
    },
    lastName: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      lowercase: true,
      required: true,
    },
    phone: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "New",
        "Contacted",
        "HotLead",
        "Cold Lead",
        "Converted",
        "Closed",
        "Bad Lead",
      ],
      default: "New",
    },
    assignedTo: {
      type: String,
    },
    assignedToRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: UserModel,
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

export const SalesLeadModel = model<SalesLeadDoc>("SalesLead", salesLeadSchema);
