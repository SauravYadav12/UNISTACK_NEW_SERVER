import { Request, Response } from "express";
import { RequirementDoc, RequirementModel } from "../models/requirementModel";
import {
  InterviewReport,
  InterviewStatus,
  MarketingReport,
  PositionReport,
  RequirementStatus,
} from "../interface/interfaces";
import { InterviewDoc, InterviewModel } from "../models/interviewModel";
import { UserDoc, UserModel } from "../models/userModel";
import { myDate } from "../utils/dateUtil";
import { UserRole } from "../enums/UserEnum";

const reqStatusList: RequirementStatus[] = [
  "New Working",
  "Submission In Progress",
  "Submitted",
  "Project Active",
  "Interviewed",
  "Project Inactive",
  "Cancelled",
];
export const interviewStatusList: InterviewStatus[] = [
  "Interview Confirm",
  "Interview Tentative",
  "Interview Cancelled",
  "Interview Completed",
  "Interview Re-Scheduled",
];
const pushAccountsWithZeroRecords = (
  recordSorted: (PositionReport | MarketingReport | InterviewReport)[],
  accounts: UserDoc[]
) => {
  const accountsWithZeroRecords = accounts.filter(
    (s) =>
      !recordSorted.find((r) => {
        return `${r.id}` === `${s._id}`;
      })
  );
  for (const s of accountsWithZeroRecords) {
    recordSorted.push({
      name: `${s.firstName} ${s.lastName}`,
      id: s._id?.toString(),
    });
  }
  return recordSorted;
};
const sortSupportRecords = (positions: RequirementDoc[]) => {
  const positionSorted: PositionReport[] = [];
  for (const req of positions) {
     if(req.duplicateWith) continue; // skip duplicate positions
    const i = positionSorted.findIndex((e) => e.name === req.reqEnteredBy);
    const info: PositionReport = i > -1 ? positionSorted[i] : {};

    info.name = req.reqEnteredBy || "NA";
    info.id = req.reqEnteredByRef?.toString();
    info.totalPositions = (info.totalPositions || 0) + 1;

    for (const status of reqStatusList) {
      if (status === req.reqStatus) {
        info[status] = (info[status] || 0) + 1;
        break;
      }
    }

    if (i > -1) {
      positionSorted[i] = info;
    } else {
      positionSorted.push(info);
    }
  }

  return positionSorted;
};

const sortMarketingRecords = (allPositions: RequirementDoc[]) => {
  const sortedRecords: MarketingReport[] = [];

  for (const req of allPositions) {
    const i = sortedRecords.findIndex((e) => e.name === req.assignedTo);

    const info: MarketingReport = i > -1 ? sortedRecords[i] : {};

    info.name = req.assignedTo;
    info.id = req.assignedToRef?.toString();
    info.totalAssigned = (info.totalAssigned || 0) + 1;

    for (const status of reqStatusList) {
      if (status === req.reqStatus) {
        info[status] = (info[status] || 0) + 1;
        break;
      }
    }

    if (i > -1) {
      sortedRecords[i] = info;
    } else {
      sortedRecords.push(info);
    }
  }

  return sortedRecords;
};

const sortInterviewsRecords = (allInterviews: InterviewDoc[]) => {
  const sortedInterviews: InterviewReport[] = [];
  for (const req of allInterviews) {
    const i = sortedInterviews.findIndex(
      (e) => e.name === (req.marketingPerson || "NA")
    );
    const info: InterviewReport = i > -1 ? sortedInterviews[i] : {};

    info.name = req.marketingPerson || "NA";
    info.id = req.marketingPersonRef?.toString();
    info.totalInterviews = (info.totalInterviews || 0) + 1;

    for (const status of interviewStatusList) {
      if (status === req.interviewStatus) {
        info[status] = (info[status] || 0) + 1;
        break;
      }
    }

    if (i > -1) {
      sortedInterviews[i] = info;
    } else {
      sortedInterviews.push(info);
    }
  }

  return sortedInterviews;
};

export const getSupportReport = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const supports = await UserModel.find({ role: UserRole.Support, active: true });
    const ids = supports.map((s) => s._id);
    const positions = await RequirementModel.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
      reqEnteredByRef: { $in: ids },
    });

    const report = pushAccountsWithZeroRecords(
      sortSupportRecords(positions),
      supports
    );

    res.status(200).json({
      data: report,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      error,
    });
  }
};

export const getMarketingReport = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const marketing = await UserModel.find({ role: UserRole.Marketing, active: true });
    const ids = marketing.map((s) => s._id);
    const positions = await RequirementModel.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
      assignedToRef: { $in: ids },
    });

    const assigned = sortMarketingRecords(positions);
    const report = pushAccountsWithZeroRecords(assigned, marketing);
    res.status(200).json({
      data: report,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      error,
    });
  }
};

export const getInterviewReport = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const marketing = await UserModel.find({ role: UserRole.Marketing, active: true });
    const ids = marketing.map((s) => s._id);
    const interviews = await InterviewModel.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
      marketingPersonRef: { $in: ids },
    });
    const report = pushAccountsWithZeroRecords(
      sortInterviewsRecords(interviews),
      marketing
    );
    res.status(200).json({
      data: {
        report,
        totalInterviews: interviews.length,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      error,
    });
  }
};

export const getDashboardReport = async (req: Request, res: Response) => {
  try {
    const reportPromises = [
      UserModel.countDocuments(),
      UserModel.countDocuments({ active: true }),
      RequirementModel.countDocuments(),
      InterviewModel.countDocuments(),
      InterviewModel.countDocuments({
        interviewStatus: "Interview Confirm",
      }),
    ];
    const [
      totalUsers,
      totalActiveUsers,
      totalRequirements,
      totalInterviews,
      totalConfirmInterviews,
    ] = await Promise.all(reportPromises);

    res.status(200).json({
      data: {
        totalUsers,
        totalActiveUsers,
        totalRequirements,
        totalInterviews,
        totalConfirmInterviews,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      error,
    });
  }
};
