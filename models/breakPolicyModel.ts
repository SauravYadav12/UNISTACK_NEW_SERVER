import { Schema, model, Document, Types } from "mongoose";
import { UserRole } from "../enums/UserEnum";

/**
 * BreakPolicy — a single settings row that decides WHO the break-discipline
 * flow applies to.
 *
 *   enabled        master switch for the whole feature
 *   enabledRoles   a user is in the flow when at least one of their roles is
 *                  listed here (super-admin is never in the flow; they don't
 *                  check in and they are the ones who unlock others)
 *   autoLockMinutes optional override of BREAK_AUTO_LOCK_MINUTES
 *
 * Admin/HR edit it from the Attendance Dashboard; the server caches it for
 * a few seconds so the sweep and every request don't hit Mongo each time.
 */

export const BREAK_POLICY_KEY = "default";

/** Every role except super-admin can be toggled; admin is OFF by default. */
export const TOGGLABLE_BREAK_ROLES: UserRole[] = Object.values(UserRole).filter(
  (r) => r !== UserRole.SuperAdmin,
);

export const DEFAULT_ENABLED_BREAK_ROLES: UserRole[] = TOGGLABLE_BREAK_ROLES.filter(
  (r) => r !== UserRole.Admin,
);

export interface BreakPolicyDoc extends Document {
  _id: Types.ObjectId;
  key: string;
  enabled: boolean;
  enabledRoles: string[];
  autoLockMinutes: number | null;
  /** Keyboard/mouse inactivity that locks the workstation; 0 = off. */
  idleMinutes: number | null;
  idleUnlockMode: "otp" | "admin";
  updatedByRef?: Types.ObjectId | null;
  updatedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const breakPolicySchema = new Schema<BreakPolicyDoc>(
  {
    key: { type: String, required: true, unique: true, default: BREAK_POLICY_KEY },
    enabled: { type: Boolean, default: true },
    enabledRoles: { type: [String], default: () => [...DEFAULT_ENABLED_BREAK_ROLES] },
    autoLockMinutes: { type: Number, default: null },
    idleMinutes: { type: Number, default: null },
    idleUnlockMode: { type: String, enum: ["otp", "admin"], default: "admin" },
    updatedByRef: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedByName: { type: String },
  },
  { timestamps: true },
);

export const BreakPolicyModel = model<BreakPolicyDoc>("BreakPolicy", breakPolicySchema);
