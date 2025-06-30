import mongoose, { Schema, Document, Types } from "mongoose";
import { RequirementModel } from "./requirementModel";
import { UserModel } from "./userModel";

interface RequirementLogDocument extends Document {
  requirementRef: Types.ObjectId;
  operation: "create" | "update" | "delete";
  userName: string;
  userRef: Types.ObjectId;
  oldData?: Partial<any>;
  newData: Partial<any>;
  createdAt: string;
  updatedAt: string;
}

const RequirementLogSchema: Schema<RequirementLogDocument> = new Schema(
  {
    requirementRef: {
      type: Schema.Types.ObjectId,
      ref: RequirementModel,
      required: true,
      index: true,
    },
    operation: {
      type: String,
      enum: ["create", "update", "delete"],
      required: true,
    },
    userName: { type: String, required: true },
    userRef: {
      type: Schema.Types.ObjectId,
      ref: UserModel,
      required: true,
    },
    newData: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

const RequirementLogModel = mongoose.model<RequirementLogDocument>(
  "RequirementLog",
  RequirementLogSchema
);

export default RequirementLogModel;
