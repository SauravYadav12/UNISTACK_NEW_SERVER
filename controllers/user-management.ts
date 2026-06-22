import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { UserModel } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { handleDateQuery } from "../utils/utils";
import { seedBalancesForUser } from "../services/leaveBalanceService";
import { computeProbationOriginalEndDate } from "../utils/probation";
import { generateEmployeeId } from "./userProfileController";

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const q = handleDateQuery(req.query);
    const users = await UserModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      users,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    // Track the prior `active` value so we can detect an inactive→active
    // transition and seed this user's leave balances on prorata basis.
    const before = await UserModel.findById(req.params.id).select("active").lean();
    const wasActive = !!before?.active;

    const user = await UserModel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (user && !wasActive && user.active) {
      // ── Inactive → Active transition ──────────────────────────────
      // Auto-stamp the joining date if HR hasn't manually set one yet,
      // so the leave engine has a probation/prorata anchor. Existing
      // dateOfJoining values are respected (HR may have backdated it
      // to match the real start). Clear any stale relievingDate from a
      // prior off-boarding cycle — the user is active again.
      // Track whether we have to STAMP the DOJ here (vs. it being
      // already set). If we do, any existing balance rows were created
      // without a DOJ — meaning they're on the legacy path and don't
      // reflect probation rules. In that case the seed must run in
      // `force: true` mode so the wrong rows get overwritten. For
      // employees who already had a DOJ (the normal re-activation
      // case) we keep `force: false` so any HR-tuned allocations
      // survive.
      let dojWasJustStamped = false;
      try {
        // Mongoose's strict TS rejects raw Types.ObjectId in filters;
        // matches the cast used elsewhere in leaveBalanceService.
        const profileFilter = { user: user._id } as FilterQuery<
          Record<string, unknown>
        >;
        const profile = await UserProfileModel.findOne(profileFilter).select(
          "dateOfJoining relievingDate probationStatus probationOriginalEndDate",
        );
        if (profile) {
          const setUpdates: Record<string, unknown> = {};
          const unsetUpdates: Record<string, unknown> = {};
          if (!profile.dateOfJoining) {
            const doj = new Date();
            setUpdates.dateOfJoining = doj;
            // Stamp the probation workflow fields on first DOJ.
            // Existing employees (DOJ already set) keep whatever
            // status they have — re-activation doesn't reset
            // probation if they're already confirmed.
            setUpdates.probationStatus = "in_progress";
            setUpdates.probationOriginalEndDate =
              computeProbationOriginalEndDate(doj);
            setUpdates.probationExtensionDays = 0;
            dojWasJustStamped = true;
          }
          if (profile.relievingDate) unsetUpdates.relievingDate = "";
          const update: Record<string, unknown> = {};
          if (Object.keys(setUpdates).length > 0) update.$set = setUpdates;
          if (Object.keys(unsetUpdates).length > 0) update.$unset = unsetUpdates;
          if (Object.keys(update).length > 0) {
            await UserProfileModel.updateOne(profileFilter, update);
          }
        } else {
          // No profile exists yet — common when a super-admin just
          // signed up a new employee and toggles activation BEFORE
          // anyone fills the profile form. Previously this branch was
          // a silent skip, which meant DOJ never got stamped and the
          // employee was invisible to the probation workflow.
          // Now we MINT a minimal profile so the probation engine has
          // an anchor + the user shows up in /probation immediately.
          // HR can fill the rest of the profile fields later via the
          // edit-profile flow without losing DOJ.
          //
          // Generate employeeId via the SHARED helper from
          // userProfileController so both auto-create-on-activation AND
          // the explicit POST /user-profiles use the same format
          // (UNI-MMYY-NNN) and the same global sequence. No risk of
          // the two paths producing different IDs.
          const doj = new Date();
          try {
            const employeeId = await generateEmployeeId(doj);
            await UserProfileModel.create({
              user: user._id,
              employeeId,
              dateOfJoining: doj,
              probationStatus: "in_progress",
              probationOriginalEndDate: computeProbationOriginalEndDate(doj),
              probationExtensionDays: 0,
            });
            dojWasJustStamped = true;
            console.log(
              `[user-mgmt] Auto-created profile on activation: user=${user._id} employeeId=${employeeId}`,
            );
          } catch (createErr) {
            // Don't fail the whole activation if the profile mint
            // hits an unexpected error (e.g. validation, dup-key
            // race with the client-side createProfile call). Log
            // loudly so HR can investigate, then continue — leave
            // balances still get seeded below, and the client-side
            // POST /user-profiles call from ActiveUserSwitch will
            // also try (and since createUserProfile is now idempotent,
            // if a profile already exists it just returns it; if not
            // it creates one using the same helper).
            console.error(
              `[user-mgmt] Failed to auto-create profile for ${user._id}:`,
              (createErr as Error).message,
            );
          }
        }
      } catch (e) {
        // Non-fatal — fall through to balance seeding even if the
        // profile stamp failed; an admin can backfill dateOfJoining
        // manually later.
        console.error(
          `[user-mgmt] Failed to auto-stamp dateOfJoining for ${user._id}:`,
          (e as Error).message,
        );
      }

      // Seed prorated balances for the current year. Force the
      // overwrite only when we just stamped DOJ for the first time —
      // that's a strong signal the existing rows (if any) were
      // computed on the legacy path and shouldn't be trusted.
      seedBalancesForUser(String(user._id), new Date().getFullYear(), {
        force: dojWasJustStamped,
      })
        .then((r) => {
          console.log(
            `[leave-balance] Seeded on activation (user=${r.userId}, year=${r.year}, multiplier=${r.multiplier}, upserted=${r.upserted}, force=${dojWasJustStamped})`,
          );
        })
        .catch((e) =>
          console.error(
            `[leave-balance] Failed to seed on activation for ${user._id}:`,
            (e as Error).message,
          ),
        );
    } else if (user && wasActive && !user.active) {
      // ── Active → Inactive transition ──────────────────────────────
      // Stamp relievingDate so the profile UI can show it and the leave
      // engine can stop accruing future allocations. Don't overwrite if
      // already set (e.g., HR explicitly set a future relieving date).
      try {
        const profileFilter = {
          user: user._id,
          relievingDate: { $in: [null, undefined] },
        } as FilterQuery<Record<string, unknown>>;
        await UserProfileModel.updateOne(profileFilter, {
          $set: { relievingDate: new Date() },
        });
      } catch (e) {
        console.error(
          `[user-mgmt] Failed to auto-stamp relievingDate for ${user._id}:`,
          (e as Error).message,
        );
      }
    }

    res.status(200).json({
      status: "success",
      user,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};
