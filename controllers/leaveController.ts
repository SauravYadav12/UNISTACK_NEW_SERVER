import { Request, Response } from "express";
import { paginationInstance } from "../utils/pagination";
import { LeaveModel, LeaveStatus } from "../models/leaveModel";
import { ILeave, IUser, UserDoc } from "../interface";
import { getLeaveRequestTemplate, getLeaveStatusTemplate } from "../templates";
import { sendMail } from "../utils/mailTransporter";
import { UserModel } from "../models/userModel";
import { MailOptions } from "nodemailer/lib/sendmail-transport";
import moment from "moment";
import { AttendanceStatus } from "../models/attendance";
import { handleMarkAttendance } from "./attendanceController";
import ENV_VARS from "../config/env.config";

function getEmailSubject(user: IUser | UserDoc) {
  const fullname =
    ((user.firstName || "") + " " + (user.lastName || "")).trim() || user.email;
  return "Leave Request from " + fullname;
}

export const getLeaves = async (req: Request, res: Response) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      LeaveModel,
    );
    const { startIndex, query, limit } = options;
    const leaves = await LeaveModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: leaves };

    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const getLeaveById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const leave = await LeaveModel.findById(id).exec();
    res.status(200).json({ data: leave });
  } catch (error) {
    console.error("Error in getLeaveById: ", error);
    res.status(500).json({ error: error });
  }
};

export const createLeave = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const newLeave = new LeaveModel({
      ...req.body,
      userRef: user._id.toString(),
    });

    const data = await newLeave.save();
    const emailHtml = await getLeaveRequestTemplate(data.toObject<ILeave>());
    const mailOptions = {
      from: user.email,
      to: ENV_VARS.COMPANY_EMAIL,
      subject: getEmailSubject(user),
      html: emailHtml,
    };

    const { messageId } = await sendMail(mailOptions);
    data.emailRefIds = [...(data.emailRefIds || []), messageId];
    await data.save();

    res.status(201).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req.user as UserDoc)._id.toString();
    const existingLeave = (await LeaveModel.findById(id)
      .lean()
      .exec()) as ILeave | null;

    if (
      existingLeave?.status === LeaveStatus.Pending &&
      req.body.status !== LeaveStatus.Pending
    ) {
      req.body.respondedAt = new Date();
      req.body.respondBy = userId;
    }

    const updatedLeave = await LeaveModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updatedLeave) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    if (
      existingLeave?.status === LeaveStatus.Pending &&
      req.body.status !== LeaveStatus.Pending
    ) {
      const emailHtml = await getLeaveStatusTemplate(
        updatedLeave.toObject<ILeave>(),
      );

      const recepient = await UserModel.findById(existingLeave.userRef);

      if (!recepient) {
        res.status(404).json({ error: "Recepient not found" });
        return;
      }

      const lastMailRef =
        updatedLeave.emailRefIds?.[updatedLeave.emailRefIds?.length - 1];

      const mailOptions: MailOptions = {
        from: ENV_VARS.COMPANY_EMAIL,
        to: recepient?.email,
        subject: (lastMailRef ? "Re: " : "") + getEmailSubject(recepient),
        html: emailHtml,
        replyTo: lastMailRef,
        references: lastMailRef ? [lastMailRef] : undefined,
      };

      const { messageId } = await sendMail(mailOptions);
      updatedLeave.emailRefIds = [
        ...(updatedLeave.emailRefIds || []),
        messageId,
      ];
      await updatedLeave.save();

      if (updatedLeave.status === LeaveStatus.Approved) {
        markAttendanceForLeave(updatedLeave.toObject<ILeave>());
      }
    }

    res.status(200).json({ data: updatedLeave });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

function markAttendanceForLeave(leave: ILeave) {
  if (leave.status !== LeaveStatus.Approved) return;
  const startDate = moment(leave.startDate);
  const endDate = moment(leave.endDate);

  try {
    const dates: string[] = [];
    const current = startDate.clone();

    while (current.isSameOrBefore(endDate)) {
      dates.push(current.format("YYYY/MM/DD"));
      current.add(1, "days");
    }

    return Promise.allSettled(
      dates.map((date) =>
        handleMarkAttendance({
          userRef: leave.userRef,
          date,
          status: AttendanceStatus.Absent,
        }),
      ),
    );
  } catch (error) {
    console.log("Error in markAttendanceForLeave: ", error);
  }
}

export const deleteLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const data = await LeaveModel.findByIdAndDelete(id);

    if (!data) {
      res.status(404).json({ error: "failed to delete" });
      return;
    }

    res.status(200).json({ data: "deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};
