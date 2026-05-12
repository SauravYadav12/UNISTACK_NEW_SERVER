import { Request, Response } from "express";
import moment from "moment";
import { AttendanceModel, AttendanceStatus } from "../models/attendance";
import { UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { handleAttendanceDateQueryParams } from "../utils/utils";

// Sat (6) / Sun (0) are non-working days company-wide. No attendance rows
// should ever be created for those dates, from any caller (employee
// self-service, admin dashboard, or the leave-approval auto-mark).
function isWeekendDate(date: string): boolean {
  const m = moment(date, "YYYY/MM/DD");
  if (!m.isValid()) return false;
  const dow = m.day();
  return dow === 0 || dow === 6;
}

export const getAttendanceList = async (req: Request, res: Response) => {
  try {
    const { error, query = {} } = handleAttendanceDateQueryParams(req.query);
    if (error) {
      res.status(400).json({
        error,
      });
    }
    // Super Admin is a system role, not an employee — its attendance rows
    // must not surface in any attendance listing.
    const superAdminIds = await UserModel.distinct("_id", {
      role: UserRole.SuperAdmin,
    });
    const data = await AttendanceModel.find({
      ...query,
      userRef: { $nin: superAdminIds },
    });
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

export const handleMarkAttendance = async (body: {
  userRef: string;
  date: string;
  status: AttendanceStatus;
}) => {
  const { userRef, date } = body;
  if (!date) {
    throw new Error(`date is required`);
  }
  if (isWeekendDate(date)) {
    throw new Error(`${date} is a weekend — attendance is not tracked on Sat/Sun`);
  }
  const q = {
    userRef,
    fromDate: date,
    toDate: date,
  };

  const { error, query = {} } = handleAttendanceDateQueryParams(q);

  if (error) {
    throw new Error(error);
  }
  const isAlreadyMarkedForDate = await AttendanceModel.exists(query);

  if (isAlreadyMarkedForDate) {
    throw new Error(`Aleady Marked for date ${date}`);
  }
  const newAttendance = new AttendanceModel({
    ...body,
  });

  return await newAttendance.save();
};

export const markAttendance = async (req: Request, res: Response) => {
  try {
    const savedAttendance = await handleMarkAttendance(req.body);
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
