import { Schema, model } from "mongoose";
import { SalesLead } from "../interface/salesLead";

export const commentSchema = new Schema({
  name: { type: String, required: true },
  comment: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

const salesLeadSchema = new Schema<SalesLead>(
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
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

export const SalesLeadModel = model<SalesLead>("SalesLead", salesLeadSchema);
