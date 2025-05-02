import mongoose from "mongoose";

const teams = new mongoose.Schema(
  {
    teamId: {
      type: String,
      unique: true,
      required:true
    },
    teamName: {
      type: String,
    },
    contactPerson: {
      type: String,
    },
    phone: {
      type: String,
    },
    createdBy: {
      type: String,
    },
    createdAt: {
      type: Date,
    },
    updatedAt: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const TeamsModel = mongoose.model("Teams", teams);

