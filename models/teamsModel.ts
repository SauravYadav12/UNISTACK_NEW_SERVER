import mongoose, { Document } from "mongoose";
import { ITeam } from "../interface/modelInterfaces";

export interface TeamDoc extends Omit<ITeam, '_id' | 'createdAt' | 'updatedAt'>, Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const teams = new mongoose.Schema<TeamDoc>(
  {
    teamId: {
      type: String,
      unique: true,
      required: true,
    },
    teamName: {
      type: String,
    },
    teckStack: {
      type: String,
    },
    developerName: {
      type: String,
    },
    createdBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const TeamsModel = mongoose.model<TeamDoc>("Teams", teams);
