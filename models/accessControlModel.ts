import { Schema, model } from "mongoose";

const accessControlSchema = new Schema({}, { timestamps: true, strict: false });

export const AccessControlModel = model("AccessControl", accessControlSchema);
