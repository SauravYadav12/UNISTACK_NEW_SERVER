import mongoose, { Schema, Document, Types } from "mongoose";
import { RequirementModel } from "./requirementModel";
import { UserModel } from "./userModel";
import { IRequirementLog } from "../interface/modelInterfaces";

export interface RequirementLogDoc extends Omit<IRequirementLog, '_id' | 'requirementRef' | 'userRef' | 'createdAt' | 'updatedAt'>, Document {
  _id: Types.ObjectId;
  requirementRef: Types.ObjectId;
  userRef: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RequirementLogSchema: Schema<RequirementLogDoc> = new Schema(
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

const RequirementLogModel = mongoose.model<RequirementLogDoc>(
  "RequirementLog",
  RequirementLogSchema
);

export default RequirementLogModel;
