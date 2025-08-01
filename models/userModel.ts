import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { UserShift, WorkLocation } from "../interface/constants";
import { UserRole } from "../enums/UserEnum";

export const allowdDomains = ["unicodez.com", "team.unicodez.com"];

const UserSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
    },
    lastName: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      lowercase: true,
      required: true,
      validate: {
        validator: function (email: string) {
          const domain = email?.split("@")[1];
          return allowdDomains.includes(domain);
        },
        message: (props: any) => `${props.value} invalid email!`,
      },
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.User,
    },
    shift: {
      type: String,
      enum: Object.values(UserShift),
      default: UserShift.US,
    },
    workLocation: {
      type: String,
      enum: Object.values(WorkLocation),
      default: WorkLocation.Office,
    },
    gender: {
      type: String,
      required: true,
    },
    active: {
      type: Boolean,
      default: false,
      select: true,
    },
    premium: {
      type: Boolean,
      default: false,
      select: true,
    },
    plan: {
      type: String,
      enum: ["free", "platinum", "business"],
      default: "free",
    },
    corpName: {
      type: String,
      required: true,
    },
    canEdit: {
      type: Boolean,
      default: false,
    },
    otp: String,
    otpExpiry: Date,
    activity: [
      {
        loggedInAt: { type: Date },
        loggedOutAt: { type: Date },
        location: { type: String },
        ip: { type: String },
      },
    ],
  },
  {
    timestamps: true,
  }
);

UserSchema.pre("save", function (next) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30 * 3));

  // Filter out activity logs older than 3 months
  (this as any).activity = ((this as any).activity || []).filter(
    ({ loggedInAt, loggedOutAt }: any) => {
      return (
        (loggedInAt && loggedInAt > thirtyDaysAgo) ||
        (loggedOutAt && loggedOutAt > thirtyDaysAgo)
      );
    }
  );

  next();
});

export const UserModel = mongoose.model("User", UserSchema);

// Get user By ID
export const getUserById = function (
  id: string,
  callback: (err: string, res: any) => void
) {
  UserModel.findById(id, callback);
};

// Adding a User
export const addUser = function (newUser: any, callback: any) {
  bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(newUser.password, salt, (err, hash) => {
      if (err) {
        console.log(err);
      } else {
        newUser.password = hash;
        newUser.save(callback);
      }
    });
  });
};

// Get User by Email

export const getUserByEmail = function (email: string, callback: any) {
  const query = { email };
  UserModel.findOne(query, callback);
};

// Compare password
export const comparePassword = function (
  candidatePassword: string,
  hash: string,
  callback: any
) {
  bcrypt.compare(candidatePassword, hash, (err, isMatch) => {
    if (err) throw err;
    callback(null, isMatch);
  });
};
