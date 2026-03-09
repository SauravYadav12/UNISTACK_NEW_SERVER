import mongoose, { CallbackError, Document } from "mongoose";
import bcrypt from "bcryptjs";
import { UserShift, WorkLocation } from "../interface/constants";
import { UserRole } from "../enums/UserEnum";
import { IUser } from "../interface/modelInterfaces";

export interface UserDoc extends Omit<IUser, '_id' | 'createdAt' | 'updatedAt' | 'otpExpiry' | 'activity'>, Document {
  _id: mongoose.Types.ObjectId;
  otpExpiry?: Date;
  activity?: Array<{
    loggedInAt?: Date;
    loggedOutAt?: Date;
    location?: string;
    ip?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export const allowdDomains = ["unicodez.com", "team.unicodez.com"];

const UserSchema = new mongoose.Schema<UserDoc>(
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
        message: (props: { value: string }) => `${props.value} invalid email!`,
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
  (this).activity = ((this).activity || []).filter(
    ({ loggedInAt, loggedOutAt }) => {
      return (
        (loggedInAt && loggedInAt > thirtyDaysAgo) ||
        (loggedOutAt && loggedOutAt > thirtyDaysAgo)
      );
    }
  );

  next();
});

export const UserModel = mongoose.model<UserDoc>("User", UserSchema);

// Get user By ID
export const getUserById = function (
  id: string,
  callback: (err: CallbackError, res: UserDoc | null) => void
) {
  UserModel.findById(id, callback);
};

// Adding a User
export const addUser = function (newUser: UserDoc, callback: (err: CallbackError, res: UserDoc | null) => void) {
  bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(newUser.password, salt, (err, hash) => {
      if (err) {
        console.log(err);
        callback(err, null);
      } else {
        newUser.password = hash;
        newUser.save(callback);
      }
    });
  });
};

// Get User by Email

export const getUserByEmail = function (email: string, callback: (err: CallbackError, res: UserDoc | null) => void) {
  const query = { email };
  UserModel.findOne(query, callback);
};

// Compare password
export const comparePassword = function (
  candidatePassword: string,
  hash: string,
  callback: (err: CallbackError, isMatch: boolean) => void
) {
  bcrypt.compare(candidatePassword, hash, (err, isMatch) => {
    if (err) throw err;
    callback(null, isMatch);
  });
};
