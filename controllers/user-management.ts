import { Request, Response } from "express";
import { UserModel } from "../models/userModel";
import { handleDateQuery } from "../utils/utils";
import { seedBalancesForUser } from "../services/leaveBalanceService";

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
      // New joiner activated — seed prorated balances for the current year
      // based on their UserProfile.dateOfJoining. Non-fatal: any failure
      // here shouldn't block the user update itself.
      seedBalancesForUser(String(user._id), new Date().getFullYear())
        .then((r) => {
          console.log(
            `[leave-balance] Seeded on activation (user=${r.userId}, year=${r.year}, multiplier=${r.multiplier}, upserted=${r.upserted})`,
          );
        })
        .catch((e) =>
          console.error(
            `[leave-balance] Failed to seed on activation for ${user._id}:`,
            (e as Error).message,
          ),
        );
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
