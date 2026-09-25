import { Types } from "mongoose";
import {
  BREAK_POLICY_KEY,
  BreakPolicyModel,
  DEFAULT_ENABLED_BREAK_ROLES,
  TOGGLABLE_BREAK_ROLES,
} from "../models/breakPolicyModel";
import { UserRole } from "../enums/UserEnum";
import ENV_VARS from "../config/env.config";

export interface BreakPolicy {
  enabled: boolean;
  enabledRoles: string[];
  /** Effective threshold (policy override or env default). */
  autoLockMinutes: number;
  /** Raw override, null when the env default is in use. */
  autoLockMinutesOverride: number | null;
  /** Inactivity lock threshold in minutes; 0 disables idle locking. */
  idleMinutes: number;
  idleUnlockMode: "otp" | "admin";
  togglableRoles: string[];
  updatedAt: Date | null;
  updatedByName: string | null;
}

const CACHE_TTL_MS = 10_000;
let cache: { policy: BreakPolicy; at: number } | null = null;

export function envAutoLockMinutes(): number {
  const n = Number(ENV_VARS.BREAK_AUTO_LOCK_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export const DEFAULT_IDLE_MINUTES = 5;

export function defaultBreakPolicy(): BreakPolicy {
  return {
    enabled: true,
    enabledRoles: [...DEFAULT_ENABLED_BREAK_ROLES],
    autoLockMinutes: envAutoLockMinutes(),
    autoLockMinutesOverride: null,
    idleMinutes: DEFAULT_IDLE_MINUTES,
    idleUnlockMode: "admin",
    togglableRoles: [...TOGGLABLE_BREAK_ROLES],
    updatedAt: null,
    updatedByName: null,
  };
}

function toPolicy(doc: {
  enabled: boolean;
  enabledRoles: string[];
  autoLockMinutes: number | null;
  idleMinutes?: number | null;
  idleUnlockMode?: "otp" | "admin";
  updatedAt?: Date;
  updatedByName?: string;
} | null): BreakPolicy {
  if (!doc) return defaultBreakPolicy();
  const override = doc.autoLockMinutes && doc.autoLockMinutes > 0 ? doc.autoLockMinutes : null;
  return {
    enabled: doc.enabled,
    enabledRoles: doc.enabledRoles.filter((r) => (TOGGLABLE_BREAK_ROLES as string[]).includes(r)),
    autoLockMinutes: override ?? envAutoLockMinutes(),
    autoLockMinutesOverride: override,
    idleMinutes: doc.idleMinutes == null ? DEFAULT_IDLE_MINUTES : Math.max(0, doc.idleMinutes),
    idleUnlockMode: doc.idleUnlockMode === "otp" ? "otp" : "admin",
    togglableRoles: [...TOGGLABLE_BREAK_ROLES],
    updatedAt: doc.updatedAt ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

export function invalidateBreakPolicyCache(): void {
  cache = null;
}

export async function getBreakPolicy(force = false): Promise<BreakPolicy> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.policy;
  const doc = await BreakPolicyModel.findOne({ key: BREAK_POLICY_KEY }).lean();
  const policy = toPolicy(doc);
  cache = { policy, at: Date.now() };
  return policy;
}

/**
 * Is this user inside the break flow under the given policy? Super-admins
 * never are. Everyone else needs the feature on AND at least one enabled role.
 */
export function roleFlowEnabled(
  user: { role?: string[] | null } | null | undefined,
  policy: BreakPolicy,
): boolean {
  const roles = user?.role || [];
  if (roles.includes(UserRole.SuperAdmin)) return false;
  if (!policy.enabled) return false;
  return roles.some((r) => policy.enabledRoles.includes(r));
}

export interface BreakPolicyPatch {
  enabled?: boolean;
  enabledRoles?: string[];
  autoLockMinutes?: number | null;
  idleMinutes?: number;
  idleUnlockMode?: "otp" | "admin";
}

export function validatePolicyPatch(body: unknown): { patch: BreakPolicyPatch } | { error: string } {
  const b = (body || {}) as Record<string, unknown>;
  const patch: BreakPolicyPatch = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { error: "enabled must be a boolean" };
    patch.enabled = b.enabled;
  }
  if (b.enabledRoles !== undefined) {
    if (!Array.isArray(b.enabledRoles) || !b.enabledRoles.every((r) => typeof r === "string")) {
      return { error: "enabledRoles must be an array of role names" };
    }
    const bad = (b.enabledRoles as string[]).filter((r) => !(TOGGLABLE_BREAK_ROLES as string[]).includes(r));
    if (bad.length) return { error: `unknown or non-togglable role(s): ${bad.join(", ")}` };
    patch.enabledRoles = Array.from(new Set(b.enabledRoles as string[]));
  }
  if (b.autoLockMinutes !== undefined) {
    if (b.autoLockMinutes === null) {
      patch.autoLockMinutes = null;
    } else {
      const n = Number(b.autoLockMinutes);
      if (!Number.isFinite(n) || n < 1 || n > 240) return { error: "autoLockMinutes must be between 1 and 240 (or null)" };
      patch.autoLockMinutes = Math.round(n);
    }
  }
  if (b.idleMinutes !== undefined) {
    const n = Number(b.idleMinutes);
    if (!Number.isFinite(n) || n < 0 || n > 240) return { error: "idleMinutes must be between 0 (off) and 240" };
    patch.idleMinutes = Math.round(n);
  }
  if (b.idleUnlockMode !== undefined) {
    if (b.idleUnlockMode !== "otp" && b.idleUnlockMode !== "admin") return { error: "idleUnlockMode must be 'otp' or 'admin'" };
    patch.idleUnlockMode = b.idleUnlockMode;
  }
  return { patch };
}

export async function updateBreakPolicy(
  patch: BreakPolicyPatch,
  admin: { _id: Types.ObjectId; firstName?: string; lastName?: string; email: string },
): Promise<BreakPolicy> {
  const name = `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || admin.email;
  const $set: Record<string, unknown> = { updatedByRef: admin._id, updatedByName: name };
  if (patch.enabled !== undefined) $set.enabled = patch.enabled;
  if (patch.enabledRoles !== undefined) $set.enabledRoles = patch.enabledRoles;
  if (patch.autoLockMinutes !== undefined) $set.autoLockMinutes = patch.autoLockMinutes;
  if (patch.idleMinutes !== undefined) $set.idleMinutes = patch.idleMinutes;
  if (patch.idleUnlockMode !== undefined) $set.idleUnlockMode = patch.idleUnlockMode;
  await BreakPolicyModel.findOneAndUpdate(
    { key: BREAK_POLICY_KEY },
    { $set, $setOnInsert: { key: BREAK_POLICY_KEY } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  invalidateBreakPolicyCache();
  return getBreakPolicy(true);
}
