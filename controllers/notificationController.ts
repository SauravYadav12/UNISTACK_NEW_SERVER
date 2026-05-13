import { Request, Response } from "express";
import mongoose from "mongoose";
import { NotificationModel } from "../models/notificationModel";
import { UserDoc } from "../models/userModel";
import { getErrorMessage } from "../utils/utils";

function currentUserId(req: Request): mongoose.Types.ObjectId | null {
  const u = req.user as UserDoc | undefined;
  return u?._id ?? null;
}

/** GET /notifications — list my notifications. */
export const listNotifications = async (req: Request, res: Response) => {
  try {
    const uid = currentUserId(req);
    if (!uid) {
      res.status(401).json({ status: "failed", message: "Unauthenticated" });
      return;
    }

    const { unreadOnly, limit } = req.query as {
      unreadOnly?: string;
      limit?: string;
    };
    const cap = Math.min(Math.max(parseInt(limit || "50", 10) || 50, 1), 200);
    const query: Record<string, unknown> = { recipientRef: uid };
    if (unreadOnly === "true") query.readAt = null;

    const [items, unreadCount] = await Promise.all([
      NotificationModel.find(query)
        .sort({ createdAt: -1 })
        .limit(cap)
        .lean(),
      NotificationModel.countDocuments({ recipientRef: uid, readAt: null }),
    ]);

    res.status(200).json({
      status: "success",
      data: { items, unreadCount },
    });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** GET /notifications/unread-count — lightweight poll target. */
export const unreadCount = async (req: Request, res: Response) => {
  try {
    const uid = currentUserId(req);
    if (!uid) {
      res.status(401).json({ status: "failed", message: "Unauthenticated" });
      return;
    }
    const count = await NotificationModel.countDocuments({
      recipientRef: uid,
      readAt: null,
    });
    res.status(200).json({ status: "success", data: { count } });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** PATCH /notifications/:id/read — mark one as read. */
export const markRead = async (req: Request, res: Response) => {
  try {
    const uid = currentUserId(req);
    if (!uid) {
      res.status(401).json({ status: "failed", message: "Unauthenticated" });
      return;
    }
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ status: "failed", message: "Invalid id" });
      return;
    }
    const updated = await NotificationModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), recipientRef: uid },
      { $set: { readAt: new Date() } },
      { new: true },
    ).lean();
    if (!updated) {
      res.status(404).json({ status: "failed", message: "Not found" });
      return;
    }
    res.status(200).json({ status: "success", data: updated });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** PATCH /notifications/read-all — mark every unread row for me as read. */
export const markAllRead = async (req: Request, res: Response) => {
  try {
    const uid = currentUserId(req);
    if (!uid) {
      res.status(401).json({ status: "failed", message: "Unauthenticated" });
      return;
    }
    const result = (await NotificationModel.updateMany(
      { recipientRef: uid, readAt: null },
      { $set: { readAt: new Date() } },
    )) as { modifiedCount?: number; nModified?: number; n?: number };
    const updated = result.modifiedCount ?? result.nModified ?? 0;
    res.status(200).json({ status: "success", data: { updated } });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};
