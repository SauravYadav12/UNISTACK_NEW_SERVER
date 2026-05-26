import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { UserProfileModel } from "../models/userProfileModel";
import { UserModel } from "../models/userModel";
import { paginationInstance } from "../utils/pagination";
import { seedBalancesForUser } from "../services/leaveBalanceService";
import { computeProbationOriginalEndDate } from "../utils/probation";

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
    const sequenceNumber = await UserProfileModel.countDocuments()+1;
    const date = new Date();
    const m = date.getMonth() + 1;
    const month = m < 10 ? `0${m}` : m;
    const day = date.getDate() < 10 ? `0${date.getDate()}` : date.getDate();
    const counter =
      sequenceNumber < 10 ? `0${sequenceNumber}` : `${sequenceNumber}`;
    const employeeId = `UNI-${day}-${month}-${date.getFullYear()}/${counter}`;

    // Auto-stamp dateOfJoining when the profile is created for an active
    // user. This is the AUTHORITATIVE place to set DOJ for new joiners:
    // the React activation flow calls `updateUser({active:true})` BEFORE
    // `createProfile`, so the activation hook sees no profile and can't
    // stamp DOJ. Setting it here closes that race and ensures probation
    // rules apply correctly. Caller-supplied dateOfJoining (HR backdating
    // an actual start) is respected.
    const incoming = (req.body || {}) as Record<string, unknown>;
    const dojFromBody = incoming.dateOfJoining
      ? new Date(String(incoming.dateOfJoining))
      : undefined;
    const dateOfJoining =
      dojFromBody && !Number.isNaN(dojFromBody.getTime())
        ? dojFromBody
        : date;

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
    res.status(500).json({ error: error });
  }
};

export const updateUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updatedUserProfile = await UserProfileModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (!updatedUserProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: updatedUserProfile });
  } catch (error) {
    res.status(500).json({ error: error });
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
