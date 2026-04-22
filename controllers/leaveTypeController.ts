import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  LeaveTypeModel,
  suggestLeaveCode,
} from "../models/leaveTypeModel";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";
import { UserModel } from "../models/userModel";

export const listLeaveTypes = async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive ? {} : { active: true };
    const data = await LeaveTypeModel.find(filter).sort({ name: 1 }).lean();
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getSuggestedCode = (req: Request, res: Response) => {
  const { name = "" } = req.query;
  res.status(200).json({ code: suggestLeaveCode(String(name)) });
};

export const createLeaveType = async (req: Request, res: Response) => {
  try {
    const { name, code, defaultAllocationPerYear = 0, paid = true, color = "", description = "" } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const finalCode = (code && String(code).trim()) || suggestLeaveCode(name);
    const doc = new LeaveTypeModel({
      name: String(name).trim(),
      code: finalCode.toUpperCase(),
      defaultAllocationPerYear: Number(defaultAllocationPerYear) || 0,
      paid: Boolean(paid),
      color,
      description,
    });
    await doc.save();

    // Give every active user a balance entry for the current year so the
    // type shows up immediately on each employee's dashboard.
    const year = new Date().getFullYear();
    const users = await UserModel.find({ active: true }).select("_id").lean();
    if (users.length) {
      await LeaveBalanceModel.bulkWrite(
        users.map((u) => ({
          updateOne: {
            filter: { user: u._id, year, leaveType: doc._id },
            update: {
              $setOnInsert: {
                user: u._id,
                year,
                leaveType: doc._id,
                allocated: doc.defaultAllocationPerYear,
                used: 0,
              },
            },
            upsert: true,
          },
        })),
      );
    }

    res.status(201).json({ data: doc });
  } catch (error) {
    const message = (error as { message?: string })?.message || "Unknown error";
    res.status(400).json({ error: message });
  }
};

export const updateLeaveType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.code) updates.code = String(updates.code).toUpperCase();
    const doc = await LeaveTypeModel.findByIdAndUpdate(id, updates, { new: true });
    if (!doc) {
      res.status(404).json({ error: "Leave type not found" });
      return;
    }
    res.status(200).json({ data: doc });
  } catch (error) {
    const message = (error as { message?: string })?.message || "Unknown error";
    res.status(400).json({ error: message });
  }
};

export const deleteLeaveType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doc = await LeaveTypeModel.findById(id);
    if (!doc) {
      res.status(404).json({ error: "Leave type not found" });
      return;
    }
    if (doc.isUnpaidBucket) {
      res.status(400).json({ error: "Cannot delete the unpaid-bucket type" });
      return;
    }
    // Soft delete: keep historical balance/leave refs intact.
    doc.active = false;
    await doc.save();
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getUnpaidBucket = async (_req: Request, res: Response) => {
  const doc = await LeaveTypeModel.findOne({ isUnpaidBucket: true }).lean();
  res.status(200).json({ data: doc });
};

// Helper used elsewhere (not exposed as route).
export async function getUnpaidBucketType() {
  return LeaveTypeModel.findOne({ isUnpaidBucket: true });
}

export async function getLeaveTypeById(id: string | Types.ObjectId) {
  return LeaveTypeModel.findById(id);
}
