import mongoose, { Document } from "mongoose";
import { IConsultant } from "../interface/modelInterfaces";

export interface ConsultantDoc extends Omit<IConsultant, '_id' | 'createdAt' | 'updatedAt' | 'projects'>, Document {
  _id: mongoose.Types.ObjectId;
  projects?: Array<{
    projectNumber?: string;
    projectName?: string;
    projectCity?: string;
    projectState?: string;
    projectStartDate?: Date;
    projectEndDate?: Date;
    projectDescription?: string;
    isCurrent?: boolean;
    projectDomain?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const consultant = new mongoose.Schema<ConsultantDoc>(
  {
    consultantId: {
      type: String,
      unique: true,
      required: true,
    },
    consultantName: {
      type: String,
    },
    consultantStatus: {
      type: String,
    },
    visaStatus: {
      type: String,
    },
    currentAddress: {
      type: String,
    },
    previousAddress: {
      type: String,
    },
    email: {
      type: String,
    },
    phone: {
      type: String,
    },
    skypeId: {
      type: String,
    },
    dob: {
      type: String,
    },
    ssn: {
      type: String,
    },
    dlNo: {
      type: String,
    },
    degree: {
      type: String,
    },
    university: {
      type: String,
    },
    yearPassing: {
      type: String,
    },
    timeZone: {
      type: String,
    },
    projects: [
      {
        projectNumber: { type: String },
        projectName: { type: String },
        projectCity: { type: String },
        projectState: { type: String },
        projectStartDate: { type: Date },
        projectEndDate: { type: Date },
        projectDescription: { type: String },
        isCurrent: Boolean,
        projectDomain: String,
      },
    ],
    psuedoName: {
      type: String,
    },
    getVisa: {
      type: String,
    },
    cameToUsYear: {
      type: String,
    },
    originCountry: {
      type: String,
    },
    lookingToChange: {
      type: String,
    },
    createdBy: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const ConsultantModel = mongoose.model<ConsultantDoc>("Consultant", consultant);
