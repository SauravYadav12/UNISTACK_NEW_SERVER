import { Schema, model, Document } from "mongoose";
import { IAccessControl } from "../interface/modelInterfaces";

export interface AccessControlDoc extends Omit<IAccessControl, '_id' | 'createdAt' | 'updatedAt'>, Document {
  _id: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const accessControlSchema = new Schema<AccessControlDoc>({}, { timestamps: true, strict: false });

export const AccessControlModel = model<AccessControlDoc>("AccessControl", accessControlSchema);
