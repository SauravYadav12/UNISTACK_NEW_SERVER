import mongoose from "mongoose";

const teams = new mongoose.Schema(
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

export const TeamsModel = mongoose.model("Teams", teams);
