import mongoose, { Document } from "mongoose";
import { UserModel } from "./userModel";
import { ConsultantModel } from "./consultantModel";
import { TeamsModel } from "./teamsModel";
import { IInterview } from "../interface/modelInterfaces";

export interface InterviewDoc extends Omit<IInterview, '_id' | 'consultantRef' | 'marketingPersonRef' | 'candidateRef' | 'createdAt' | 'updatedAt'>, Document {
  _id: mongoose.Types.ObjectId;
  consultantRef?: mongoose.Types.ObjectId;
  marketingPersonRef?: mongoose.Types.ObjectId;
  candidateRef?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const interviewSchema = new mongoose.Schema<InterviewDoc>(
  {
    intId: {
      type: String,
      unique: true,
      required: true,
    },
    interviewDate: {
      type: String,
    },
    interviewTime: {
      type: String,
    },
    interviewType: {
      type: String,
    },
    interviewStatus: {
      type: String,
    },
    intResult: {
      type: String,
    },
    consultant: {
      type: String,
    },
    consultantRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: ConsultantModel,
    },
    marketingPerson: {
      type: String,
    },
    marketingPersonRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: UserModel,
    },
    vendorCompany: {
      type: String,
    },
    primeVendorCompany: {
      type: String,
    },
    tentativeReason: {
      type: String,
    },
    gitHubLink: {
      type: String,
    },
    codeLink: {
      type: String,
    },
    result: {
      type: String,
    },
    subjectLine: {
      type: String,
    },
    interviewMode: {
      type: String,
    },
    interviewLink: {
      type: String,
    },
    interviewFocus: {
      type: String,
    },
    jobDescription: {
      type: String,
    },
    interviewFeedback: {
      type: String,
    },
    taxType: {
      type: Array,
    },
    clientName: {
      type: String,
    },
    duration: {
      type: Array,
    },
    candidateName: {
      type: String,
    },
    candidateRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: TeamsModel,
    },
     teckStack: {
      type: String,
    },
    developerName: {
      type: String,
    },
    recordOwner: {
      type: String,
    },
    reqID: {
      type: String,
    },
    recordId: {
      type: String,
    },
    interviewRound: {
      type: String,
    },
    interviewViaMode: {
      type: String,
    },
    meetingType: {
      type: String,
    },
    interviewDuration: {
      type: String,
    },
    interviewWith: {
      type: String,
    },
    jobTitle: {
      type: String,
    },
    timeShift: {
      type: String,
    },
    timeZone: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
    remarks: {
      type: String,
    },
    specialNote: {
      type: String,
    },
    script: String,
  },
  {
    timestamps: true,
  }
);

export const InterviewModel = mongoose.model<InterviewDoc>("Interview", interviewSchema);
