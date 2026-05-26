import { Schema, model, Document } from "mongoose";

import { UserModel } from "./userModel";
import {
  Address,
  BankDetails,
  ProfileEmail,
  UserProfile,
} from "../interface/userProfile";

export interface UserProfileDoc extends Omit<UserProfile, '_id' | 'user' | 'dob' | 'dateOfJoining'>, Document {
  _id: Schema.Types.ObjectId;
  user: Schema.Types.ObjectId;
  dob?: Date;
  dateOfJoining?: Date;
  // Set when the employee is marked inactive. Cleared if they're
  // reactivated later. Used by the leave engine to stop accruing leaves
  // after the relieving date and surfaced on the profile UI.
  relievingDate?: Date;
  // ── Probation workflow ──────────────────────────────────────────────
  // Status drives whether leaves accrue. New joiners are 'in_progress'
  // from day 1; an admin must explicitly Confirm before any paid leaves
  // are credited. There is NO automatic flip — strict gate.
  probationStatus?: "in_progress" | "confirmed";
  // 90 days from dateOfJoining (set at activation). Daily cron uses this
  // to fire a notification once it's passed and status is still
  // in_progress. Admin extension increments this (e.g., +30 days).
  probationOriginalEndDate?: Date;
  // The date admin chose when confirming probation. May be backdated
  // (admin saw it late) or forward (early confirmation) — whatever
  // makes business sense. This is the anchor the leave engine uses
  // to compute prorata after confirmation.
  probationEndDate?: Date;
  // Audit trail for confirmation.
  probationConfirmedAt?: Date;
  probationConfirmedBy?: Schema.Types.ObjectId;
  // Running total of days the original window was extended by.
  // Increment-only; surfaces in the admin UI / audit log.
  probationExtensionDays?: number;
}
const urlValidator = {
  validator: (v: string) => !v || /^https:\/\/.+/.test(v),
  message: "Must be a valid HTTPS URL",
};

const defaultEmail = {
  personal: "",
  official: "",
};

const defaultAddress: Address = {
  address1: "",
  address2: "",
  country: "",
  state: "",
  city: "",
  "zip/pin": "",
};

const defaultBankDetails: BankDetails = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  ifscCode: "",
  swiftCode: "",
  bankAddress: "",
};
const addressSchema = new Schema<Address>({
  address1: { type: String, default: "" },
  address2: { type: String, default: "" },
  country: { type: String, default: "" },
  state: { type: String, default: "" },
  city: { type: String, default: "" },
  "zip/pin": { type: String, default: "" },
});

const bankDetailsSchema = new Schema<BankDetails>({
  accountName: { type: String, default: "" },
  accountNumber: { type: String, default: "" },
  bankName: { type: String, default: "" },
  ifscCode: { type: String, default: "" },
  swiftCode: { type: String, default: "" },
  bankAddress: { type: String, default: "" },
});

const profileEmailSchema = new Schema<ProfileEmail>({
  personal: {
    type: String,
    default: "",
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  official: {
    type: String,
    default: "",
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
});

const userProfileSchema = new Schema<UserProfileDoc>(
  {
    user: {
      unique: true,
      required: true,
      type: Schema.Types.ObjectId,
      ref: UserModel,
    },
    employeeId: {
      unique: true,
      type: String,
      required: true,
    },
    name: {
      type: String,
      default: "",
      maxLength: 20,
    },
    photo: { type: String, validate: urlValidator, default: "" },
    email: { type: profileEmailSchema, default: defaultEmail },
    dob: { type: Date, default: "" },
    phoneNumber: {
      type: String,
      default: "",
      match: /^\+?[1-9]\d{4,14}$/,
    },
    emergencyPhoneNumber: {
      type: String,
      match: /^\+?[1-9]\d{4,14}$/,
      default: "",
    },
    panNumber: {
      type: String,
      default: "",
    },
    aadharNumber: { type: String, default: "" },
    bankDetails: { type: bankDetailsSchema, default: defaultBankDetails },
    communicationAddress: { type: addressSchema, default: defaultAddress },
    permanentAddress: { type: addressSchema, default: defaultAddress },
    panCopy: { type: String, validate: urlValidator, default: "" },
    aadharCopy: { type: String, validate: urlValidator, default: "" },
    resume: { type: String, validate: urlValidator, default: "" },
    designation: { type: String, default: "" },
    dateOfJoining: { type: Date },
    // Set on deactivation, cleared on reactivation. Drives leave-accrual
    // cutoff and visible on the profile UI.
    relievingDate: { type: Date },
    // ── Probation workflow ────────────────────────────────────────────
    probationStatus: {
      type: String,
      enum: ["in_progress", "confirmed"],
    },
    probationOriginalEndDate: { type: Date },
    probationEndDate: { type: Date },
    probationConfirmedAt: { type: Date },
    probationConfirmedBy: { type: Schema.Types.ObjectId, ref: "User" },
    probationExtensionDays: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const UserProfileModel = model<UserProfileDoc>(
  "UserProfile",
  userProfileSchema
);
