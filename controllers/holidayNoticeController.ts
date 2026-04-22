import { Request, Response } from "express";
import {
  getHolidayNoticeSettings,
  HolidayNoticeSettingsModel,
} from "../models/holidayNoticeSettingsModel";
import {
  previewHolidayNotice,
  sendHolidayNoticesForToday,
} from "../services/holidayNoticeService";
import { UserDoc } from "../interface";
import { Types } from "mongoose";

export const getSettings = async (_req: Request, res: Response) => {
  try {
    const data = await getHolidayNoticeSettings();
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc | undefined;
    const body = req.body as Record<string, unknown>;

    // Allow-list editable fields so the singleton can't be weaponised into
    // storing unrelated state.
    const updates: Record<string, unknown> = {};
    for (const k of ["enabled", "daysBefore", "subject", "heading", "bodyLead", "bodyDetails", "signOff"] as const) {
      if (k in body) updates[k] = body[k];
    }
    if (me?._id) updates.updatedBy = me._id;

    // Ensure a doc exists, then patch.
    await getHolidayNoticeSettings();
    const doc = await HolidayNoticeSettingsModel.findOneAndUpdate(
      {},
      { $set: updates },
      { new: true },
    );
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const previewTemplate = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const data = await previewHolidayNotice({
      employeeName: q.employeeName,
      holidayName: q.holidayName,
      holidayDate: q.holidayDate,
      daysUntil: q.daysUntil ? Number(q.daysUntil) : undefined,
      country: q.country,
    });
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const runNow = async (_req: Request, res: Response) => {
  try {
    const result = await sendHolidayNoticesForToday();
    res.status(200).json({ data: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// Useful when an admin wants to force-resend (e.g. after editing the
// template). Clears noticeSentAt on future holidays so the next tick picks
// them up again.
export const clearSentFlagsForFuture = async (_req: Request, res: Response) => {
  try {
    const moment = (await import("moment")).default;
    const today = moment().startOf("day").format("YYYY/MM/DD");
    const result = await (await import("../models/holidayModel")).HolidayModel.updateMany(
      { fromDate: { $gte: today }, noticeSentAt: { $exists: true } },
      { $unset: { noticeSentAt: "", noticeSentTo: "" } },
    );
    const modified = (result as unknown as { nModified?: number; modifiedCount?: number }).modifiedCount
      ?? (result as unknown as { nModified?: number }).nModified
      ?? 0;
    res.status(200).json({ data: { cleared: modified } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// Satisfy TS unused-imports warning when the future-clear helper is unused.
void Types;
