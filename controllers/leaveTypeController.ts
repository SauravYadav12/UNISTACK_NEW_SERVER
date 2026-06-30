import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  LeaveTypeModel,
  suggestLeaveCode,
  ensureUnpaidBucket,
  ensureCanonicalLeaveTypeFlags,
} from "../models/leaveTypeModel";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";
import { LeaveModel } from "../models/leaveModel";
import { UserModel } from "../models/userModel";

export const listLeaveTypes = async (req: Request, res: Response) => {
  try {
    // Probation users may only apply for unpaid leave, so the picker
    // is empty unless the UL bucket row exists. The full seeder skips
    // when the collection already has rows — `ensureUnpaidBucket`
    // closes that gap idempotently on every list call.
    // `ensureCanonicalLeaveTypeFlags` likewise self-heals stale flag
    // values on well-known types (e.g. forces ML.requiresAttachment).
    await Promise.all([
      ensureUnpaidBucket(),
      ensureCanonicalLeaveTypeFlags(),
    ]);
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

    // Try a HARD delete first — possible when nothing references this
    // type yet (typical for accidentally-created types, or built-in
    // types like "Casual Leave" / "Sick Leave" the org never used).
    // Bail to soft-delete the moment we find even one Leave or
    // LeaveBalance pointing at it, since those rows would be orphaned.
    const [usedByLeave, usedByBalance] = await Promise.all([
      LeaveModel.exists({ leaveType: doc._id }),
      // A balance with `used > 0` means real history. A balance with
      // `used: 0` is just an auto-seeded placeholder — those CAN be
      // safely deleted alongside the type so the panel actually
      // becomes empty.
      LeaveBalanceModel.exists({ leaveType: doc._id, used: { $gt: 0 } }),
    ]);

    if (!usedByLeave && !usedByBalance) {
      // No real history → hard-delete the type AND any zero-used
      // placeholder balances. Result: the panel and any allocation
      // grids actually drop this type completely.
      await LeaveBalanceModel.deleteMany({ leaveType: doc._id });
      await LeaveTypeModel.findByIdAndDelete(doc._id);
      res.status(200).json({
        data: { _id: doc._id, hardDeleted: true },
        message: `"${doc.name}" deleted.`,
      });
      return;
    }

    // Soft delete — preserve historical refs.
    doc.active = false;
    await doc.save();
    res.status(200).json({
      data: doc,
      message: `"${doc.name}" deactivated (past leaves or balances reference it; full removal not possible).`,
    });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getUnpaidBucket = async (_req: Request, res: Response) => {
  // Auto-create on the read path so external integrations never see
  // a null UL row in a system that pre-dates the seeder.
  await ensureUnpaidBucket();
  const doc = await LeaveTypeModel.findOne({ isUnpaidBucket: true }).lean();
  res.status(200).json({ data: doc });
};

// Helper used elsewhere (not exposed as route).
export async function getUnpaidBucketType() {
  await ensureUnpaidBucket();
  return LeaveTypeModel.findOne({ isUnpaidBucket: true });
}

export async function getLeaveTypeById(id: string | Types.ObjectId) {
  return LeaveTypeModel.findById(id);
}
