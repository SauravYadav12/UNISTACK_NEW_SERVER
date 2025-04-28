import { Request, Response } from "express";
import { AttendanceModel } from "../models/attendance";
import { handleAttendanceDateQueryParams } from "../utils/utils";

export const getAttendanceList = async (req: Request, res: Response) => {
  try {
    const { error, query } = handleAttendanceDateQueryParams(req.query);
    if (error) {
      res.status(400).json({
        error,
      });
    }
    const data = await AttendanceModel.find(query);
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

export const markAttendance = async (req: Request, res: Response) => {
  try {
    const { userRef, date } = req.body;
    if (!date) {
      res.status(404).json({ error: `date is required` });
      return;
    }
    const q = {
      userRef,
      fromDate: date,
      toDate: date,
    };

    const { error, query } = handleAttendanceDateQueryParams(q);
    
    if (error) {
      res.status(400).json({
        error,
      });
    }
    const isAlreadyMarkedForDate = await AttendanceModel.exists(query);

    if (isAlreadyMarkedForDate) {
      res.status(404).json({ error: `Aleady Marked for date ${date}` });
      return;
    }
    const newAttendance = new AttendanceModel({
      ...req.body,
    });

    const savedAttendance = await newAttendance.save();
    res.status(201).json({ data: savedAttendance });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updated = await AttendanceModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updated) {
      res.status(404).json({ error: "Attendance not marked yet" });
      return;
    }

    res.status(200).json({ data: updated });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export async function deleteAttendance(req: Request, res: Response) {
  try {
    await AttendanceModel.findByIdAndDelete(req.params.id);
    res.json({ message: "deleted", status: true });
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
