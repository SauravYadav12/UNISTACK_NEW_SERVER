import mongoose, { Document } from "mongoose";
import { IOrganization } from "../interface/modelInterfaces";

export interface OrganizationDoc
  extends Omit<IOrganization, "_id" | "createdAt" | "updatedAt">,
    Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new mongoose.Schema<OrganizationDoc>(
  {
    orgId: { type: String, unique: true, required: true },
    name: { type: String, required: true, trim: true },
    // shortCode gets used inside invoice numbers (INV-{SHORT}-YYYYMM-NN), so
    // it's uppercased + length-capped at the schema level.
    shortCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 5,
    },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    einNumber: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

export const OrganizationModel = mongoose.model<OrganizationDoc>(
  "Organization",
  organizationSchema
);
