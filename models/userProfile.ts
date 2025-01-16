import { Schema, model } from "mongoose";

import User from "./user";
import {
  Address,
  BankDetails,
  ProfileEmail,
  UserProfile,
} from "../interface/userProfile";
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

const userProfileSchema = new Schema<UserProfile>(
  {
    user: {
      unique: true,
      required: true,
      type: Schema.Types.ObjectId,
      ref: User,
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
    email: { type: profileEmailSchema, required: true, default: defaultEmail },
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
  },
  { timestamps: true }
);

export const UserProfileModel = model<UserProfile>(
  "UserProfile",
  userProfileSchema
);
