import { Request, Response } from "express";
import { handleAttendanceDateQueryParams } from "../utils/utils";
import { checkHolidayOverlap, HolidayModel } from "../models/holidayModel";
import { sendHolidayCancelledNotice } from "../services/holidayNoticeService";

export const getHolidays = async (req: Request, res: Response) => {
  try {
    const { error, query = {} } = handleAttendanceDateQueryParams(req.query);
    if (error) {
      res.status(400).json({
        error,
      });
    }
    const data = await HolidayModel.find(query);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const markHoliday = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate) {
      res.status(404).json({ error: `fromDate is required` });
      return;
    }
    const isOverlapping = await checkHolidayOverlap(
      fromDate,
      toDate || fromDate,
    );

    if (isOverlapping) {
      res.status(400).json({
        success: false,
        error: "Holiday dates overlap with an existing holiday",
      });
      return;
    }
    const newHoliday = new HolidayModel({
      ...req.body,
      toDate: toDate || fromDate,
    });

    const savedHoliday = await newHoliday.save();
    res.status(201).json({ data: savedHoliday });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateHoliday = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fromDate, toDate } = req.body;

    if (fromDate || toDate) {
      const isOverlapping = await checkHolidayOverlap(
        fromDate,
        toDate,
        id.toString(),
      );

      if (isOverlapping) {
        res.status(400).json({
          success: false,
          error: "Holiday dates overlap with an existing holiday",
        });
        return;
      }
    }

    const updated = await HolidayModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updated) {
      res.status(404).json({ error: "Holiday not marked yet" });
      return;
    }

    res.status(200).json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export async function deleteHoliday(req: Request, res: Response) {
  try {
    // Opt-in from the remove dialog's "notify all staff" toggle.
    const notify = req.query.notify === "true";
    // Grab the doc as we delete it so the email can describe which holiday.
    const holiday = await HolidayModel.findByIdAndDelete(req.params.id).lean();
    res.json({ message: "deleted", status: true });

    if (notify && holiday) {
      // Fire-and-forget: the removal is already confirmed to the client, so
      // SMTP latency (one email per active employee) never blocks the response.
      sendHolidayCancelledNotice(holiday).catch((e) =>
        console.error(
          "[holiday-cancel] notification failed:",
          (e as Error).message,
        ),
      );
    }
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
