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

const sortSupportRecords = (positions: any[]) => {
  let positionSorted: PositionReport[] = [];
  for (let req of positions) {
    const i = positionSorted.findIndex((e) => e.name === req.recordOwner);
    let info: PositionReport = i > -1 ? positionSorted[i] : {};

    info.name = req.reqEnteredBy || "NA";
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
  let unassigned: any[] = [];

  for (let req of allPositions) {
    if (!req.assignedTo) {
      unassigned.push(req);
      continue;
    }

    const i = sortedRecords.findIndex(
      (e) => e.marketingPerson === req.assignedTo
    );

    let info: MarketingReport = i > -1 ? sortedRecords[i] : {};

    info.marketingPerson = req.assignedTo || "NA";
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

  return [sortedRecords, unassigned];
};

const sortInterviewsRecords = (allInterviews: any[]) => {
  let sortedInterviews: InterviewReport[] = [];
  for (let req of allInterviews) {
    const i = sortedInterviews.findIndex((e) => e.name === req.marketingPerson);
    let info: InterviewReport = i > -1 ? sortedInterviews[i] : {};

    info.name = req.marketingPerson || "NA";
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
    const parsedStartDate = Date.parse(fromDate as string) || new Date();
    const parsedEndDate = Date.parse(toDate as string) || new Date();
    const positions = await Requirement.find({
      createdAt: {
        $gte: parsedStartDate,
        $lte: parsedEndDate,
      },
      //   isDuplicate:false
    });
    const report = sortSupportRecords(positions);
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
    const parsedStartDate = Date.parse(fromDate as string) || new Date();
    const parsedEndDate = Date.parse(toDate as string) || new Date();
    const positions = await Requirement.find({
      createdAt: {
        $gte: parsedStartDate,
        $lte: parsedEndDate,
      },
    });
    const [assigned, unassigned] = sortMarketingRecords(positions);
    res.status(200).json({
      data: {
        assigned,
        unassigned,
      },
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
    const parsedStartDate = Date.parse(fromDate as string) || new Date();
    const parsedEndDate = Date.parse(toDate as string) || new Date();
    const interviews = await Interview.find({
      createdAt: {
        $gte: parsedStartDate,
        $lte: parsedEndDate,
      },
    });
    const report = sortInterviewsRecords(interviews);
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
