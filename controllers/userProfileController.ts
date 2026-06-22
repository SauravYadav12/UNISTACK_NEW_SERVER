import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { UserProfileModel } from "../models/userProfileModel";
import { UserModel } from "../models/userModel";
import { paginationInstance } from "../utils/pagination";
import { seedBalancesForUser } from "../services/leaveBalanceService";
import { computeProbationOriginalEndDate } from "../utils/probation";

// Distill any thrown error into a single user-facing string the React
// form can render. Mongoose ValidationError carries nested per-field
// messages — we collapse them to "Field: message; Field2: ..." so the
// employee can see EXACTLY which field is failing instead of a generic
// "something went wrong". Duplicate-key errors expose the conflicting
// field name. Anything else falls through to its `.message`.
function formatProfileError(err: unknown): string {
  if (!err) return "Something went wrong";
  const e = err as {
    name?: string;
    code?: number;
    message?: string;
    errors?: Record<string, { message?: string; path?: string }>;
    keyValue?: Record<string, unknown>;
  };
  if (e.name === "ValidationError" && e.errors) {
    const parts = Object.entries(e.errors).map(([field, info]) => {
      const friendly = field
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
      return `${friendly}: ${info?.message || "invalid"}`;
    });
    return parts.join("; ");
  }
  if (e.code === 11000 && e.keyValue) {
    const field = Object.keys(e.keyValue)[0];
    const value = e.keyValue[field];
    return `${field} "${value}" is already in use`;
  }
  return e.message || "Something went wrong";
}

/**
 * Generates the next employee ID in the canonical format
 *   `UNI-MMYY-NNN`
 * e.g. `UNI-0626-054` for the 54th profile created in June 2026.
 *
 * The sequence is **global** (never resets per-month) so each employee
 * has a unique number that persists across years. We derive it from
 * the MAX of all existing trailing numbers — robust against deleted
 * docs (countDocuments() would under-count). Handles both:
 *   - New format:   `UNI-MMYY-NNN`  (after this change)
 *   - Legacy format: `UNI-DD-MM-YYYY/NN`  (created by earlier code)
 * So a mid-migration database with both formats still produces a
 * sequentially-correct next ID.
 *
 * Exported so the activation hook in user-management.ts can use the
 * same helper — single source of truth, no chance of two paths
 * generating different formats.
 */
export async function generateEmployeeId(date = new Date()): Promise<string> {
  const all = await UserProfileModel.find({
    employeeId: { $regex: /^UNI-/ },
  })
    .select("employeeId")
    .lean();
  let maxSeq = 0;
  for (const row of all) {
    const eid = (row as { employeeId?: string }).employeeId || "";
    // Match the trailing integer regardless of the separator before it:
    //   `UNI-0626-054` → 054
    //   `UNI-23-06-2026/01` → 01
    const m = eid.match(/[\/\-](\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  const next = maxSeq + 1;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yearShort = String(date.getFullYear()).slice(-2);
  return `UNI-${month}${yearShort}-${String(next).padStart(3, "0")}`;
}

export const getUserProfiles = async (req: Request, res: Response) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      UserProfileModel
    );
    const { startIndex, query, limit } = options;
    const userProfiles = await UserProfileModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: userProfiles };
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const createUserProfile = async (req: Request, res: Response) => {
  try {
    const incoming = (req.body || {}) as Record<string, unknown>;

    // ─── Idempotency guard ──────────────────────────────────────────
    // The activation flow on the client fires TWO requests back-to-back:
    //   1. PATCH /users/:id  { active: true }  → server's updateUser
    //      hook auto-creates a profile (since v? of this code).
    //   2. POST  /user-profiles  { user, email, name }  → this endpoint.
    // Both target the same `user` field, which is `unique: true` in
    // the schema. Without this guard the second one races and either:
    //   (a) hits a duplicate-key error and the client swallows it
    //       silently, leaving a profile with the WRONG format /
    //       missing DOJ, or
    //   (b) wins the race but later code paths break.
    // If a profile for this user already exists, just return it.
    // Caller treats this as success; no race, no dup-key, no silent
    // data loss.
    if (incoming.user) {
      const existing = await UserProfileModel.findOne({
        user: incoming.user,
      });
      if (existing) {
        res.status(200).json({ data: existing });
        return;
      }
    }

    // Generate canonical employee ID via the shared helper (UNI-MMYY-NNN).
    // Both this endpoint AND the activation auto-create call use this
    // function — same format, sequence drawn from a single source of truth.
    const employeeId = await generateEmployeeId();

    // Auto-stamp dateOfJoining when the profile is created for an active
    // user. Caller-supplied dateOfJoining (HR backdating an actual start)
    // is respected.
    // Defensive cleanup: drop an empty-string `_id` so Mongoose doesn't
    // try to cast "" → ObjectId (which fails with CastError), and strip
    // whitespace / separators from phone numbers so the schema's strict
    // regex doesn't reject inputs the user typed with spaces.
    if (typeof incoming._id === "string" && incoming._id.trim() === "") {
      delete incoming._id;
    }
    const normPhone = (v: unknown) =>
      typeof v === "string" ? v.replace(/[\s()\-.]/g, "") : v;
    if (typeof incoming.phoneNumber === "string") {
      incoming.phoneNumber = normPhone(incoming.phoneNumber);
    }
    if (typeof incoming.emergencyPhoneNumber === "string") {
      incoming.emergencyPhoneNumber = normPhone(incoming.emergencyPhoneNumber);
    }
    const dojFromBody = incoming.dateOfJoining
      ? new Date(String(incoming.dateOfJoining))
      : undefined;
    const dateOfJoining =
      dojFromBody && !Number.isNaN(dojFromBody.getTime())
        ? dojFromBody
        : new Date();

    // Probation workflow defaults — only set if not supplied in the
    // body (HR may seed a backfilled employee already-confirmed).
    const probationDefaults: Record<string, unknown> = {};
    if (!incoming.probationStatus) {
      probationDefaults.probationStatus = "in_progress";
    }
    if (!incoming.probationOriginalEndDate) {
      probationDefaults.probationOriginalEndDate =
        computeProbationOriginalEndDate(dateOfJoining);
    }
    if (incoming.probationExtensionDays == null) {
      probationDefaults.probationExtensionDays = 0;
    }

    const newUserProfile = new UserProfileModel({
      ...req.body,
      employeeId,
      dateOfJoining,
      ...probationDefaults,
    });

    const savedUserProfile = await newUserProfile.save();

    // Now that DOJ is known, re-seed leave balances with probation logic.
    // The activation hook may have created balance rows on the legacy
    // path (multiplier=1, no probation) because the profile didn't
    // exist yet — `force: true` overwrites those wrong rows with the
    // correct probation-aware allocation. Non-fatal: if seeding fails,
    // the profile is still created.
    try {
      const userId = String(savedUserProfile.user);
      // Cast filter to bypass Mongoose's strict ObjectId typing — same
      // pattern used elsewhere in this codebase (leaveBalanceService).
      const userFilter = { _id: savedUserProfile.user } as FilterQuery<
        Record<string, unknown>
      >;
      const userIsActive = await UserModel.findOne(userFilter)
        .select("active")
        .lean();
      if (userIsActive?.active) {
        const r = await seedBalancesForUser(userId, new Date().getFullYear(), {
          force: true,
        });
        console.log(
          `[leave-balance] Re-seeded after profile-create (user=${r.userId}, year=${r.year}, multiplier=${r.multiplier}, upserted=${r.upserted})`,
        );
      }
    } catch (e) {
      console.error(
        "[leave-balance] Failed to re-seed after profile-create:",
        (e as Error).message,
      );
    }

    res.status(201).json({ data: savedUserProfile });
  } catch (error) {
    res.status(400).json({ error: formatProfileError(error) });
  }
};

export const updateUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Mirror the create-path sanitization so phone numbers typed with
    // spaces ("+91 98232 32434") never get persisted as-is and trip
    // the schema's `match` regex on any later operation that runs
    // validators (e.g. a future findOneAndUpdate with runValidators).
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body._id === "string" && body._id.trim() === "") {
      delete body._id;
    }
    const normPhone = (v: unknown) =>
      typeof v === "string" ? v.replace(/[\s()\-.]/g, "") : v;
    if (typeof body.phoneNumber === "string") {
      body.phoneNumber = normPhone(body.phoneNumber);
    }
    if (typeof body.emergencyPhoneNumber === "string") {
      body.emergencyPhoneNumber = normPhone(body.emergencyPhoneNumber);
    }

    const updatedUserProfile = await UserProfileModel.findByIdAndUpdate(
      id,
      body,
      { new: true }
    );

    if (!updatedUserProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: updatedUserProfile });
  } catch (error) {
    res.status(400).json({ error: formatProfileError(error) });
  }
};

export const deleteUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedUserProfile = await UserProfileModel.findByIdAndDelete(id);

    if (!deletedUserProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: "User Profile deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const userProfile = await UserProfileModel.findById(id);

    if (!userProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: userProfile });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};
