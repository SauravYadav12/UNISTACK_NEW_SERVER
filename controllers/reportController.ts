import { Request, Response } from "express";
import Requirement from "../models/requirement";
import {
  InterviewReport,
  InterviewStatus,
  MarketingReport,
  PositionReport,
  RequirementStatus,
} from "../interface/interfaces";
import Interview from "../models/interview";
import User from "../models/user";
import { myDate } from "../utils/dateUtil";

const reqStatusList: RequirementStatus[] = [
  "New Working",
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
  accounts: any[]
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
      id: s._id,
    });
  }
  return recordSorted;
};
const sortSupportRecords = (positions: any[]) => {
  let positionSorted: PositionReport[] = [];
  for (let req of positions) {
    const i = positionSorted.findIndex((e) => e.name === req.reqEnteredBy);
    let info: PositionReport = i > -1 ? positionSorted[i] : {};

    info.name = req.reqEnteredBy || "NA";
    info.id = req.reqEnteredByRef;
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

const sortMarketingRecords = (allPositions: any[]) => {
  let sortedRecords: MarketingReport[] = [];

  for (let req of allPositions) {
    const i = sortedRecords.findIndex((e) => e.name === req.assignedTo);

    let info: MarketingReport = i > -1 ? sortedRecords[i] : {};

    info.name = req.assignedTo;
    info.id = req.assignedToRef;
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

const sortInterviewsRecords = (allInterviews: any[]) => {
  let sortedInterviews: InterviewReport[] = [];
  for (let req of allInterviews) {
    const i = sortedInterviews.findIndex(
      (e) => e.name === (req.marketingPerson || "NA")
    );
    let info: InterviewReport = i > -1 ? sortedInterviews[i] : {};

    info.name = req.marketingPerson || "NA";
    info.id = req.marketingPersonRef;
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
    let { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const supports = await User.find({ role: "support" });
    const ids = supports.map((s) => s._id);
    const positions = await Requirement.find({
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
    let { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const marketing = await User.find({ role: "marketing" });
    const ids = marketing.map((s) => s._id);
    const positions = await Requirement.find({
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
    let { fromDate, toDate } = req.query;
    const { from, to } = myDate(fromDate, toDate);
    const marketing = await User.find({ role: "marketing" });
    const ids = marketing.map((s) => s._id);
    const interviews = await Interview.find({
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




