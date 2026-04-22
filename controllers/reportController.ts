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
import { bestChildStatus } from "../utils/requirementRollup";

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
const sortSupportRecords = (
  positions: RequirementDoc[],
  childrenByParent?: Map<string, RequirementDoc[]>,
) => {
  const positionSorted: PositionReport[] = [];
  for (const req of positions) {
    if (req.duplicateWith) continue; // skip duplicate positions
    if (req.parentReqID) continue; // skip child assignments — parent is credited once
    const i = positionSorted.findIndex((e) => e.name === req.reqEnteredBy);
    const info: PositionReport = i > -1 ? positionSorted[i] : {};

    info.name = req.reqEnteredBy || "NA";
    info.id = req.reqEnteredByRef?.toString();
    info.totalPositions = (info.totalPositions || 0) + 1;

    // Status distribution: if this parent has children, credit the best
    // status any of them reached (post-assignment the parent's own status
    // is stale). Legacy standalone rows (no children) fall back to their
    // own reqStatus, preserving pre-split behavior.
    const kids = childrenByParent?.get(req.reqID || "") || [];
    const effectiveStatus = kids.length ? bestChildStatus(kids) : undefined;
    const statusForCount = effectiveStatus || req.reqStatus;
    for (const status of reqStatusList) {
      if (status === statusForCount) {
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

const sortMarketingRecords = (
  allPositions: RequirementDoc[],
  parentIdsWithChildrenOverride?: Set<string>,
) => {
  const sortedRecords: MarketingReport[] = [];

  // Defensive: if a legacy parent still carries an `assignedToRef` AND has
  // children, skip the parent — its children will contribute their real
  // per-marketer counts. Without this, the parent would double-count into
  // whatever marketer it was legacy-assigned to.
  //
  // Prefer the caller-provided set (built from a global distinct query so it
  // catches children outside this result window); fall back to an in-function
  // pass when the caller doesn't supply one.
  let parentIdsWithChildren = parentIdsWithChildrenOverride;
  if (!parentIdsWithChildren) {
    parentIdsWithChildren = new Set<string>();
    for (const r of allPositions) {
      if (r.parentReqID) parentIdsWithChildren.add(r.parentReqID);
    }
  }

  for (const req of allPositions) {
    if (!req.parentReqID && parentIdsWithChildren.has(req.reqID || "")) continue;
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
    // Pull parents AND children in the date range — children inherit
    // `reqEnteredByRef` on creation so they come through the same filter.
    // The sort function skips children in the row iteration but needs
    // them indexed so it can roll up the best status onto each parent.
    const positions = await RequirementModel.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
      reqEnteredByRef: { $in: ids },
    });

    const childrenByParent = new Map<string, RequirementDoc[]>();
    for (const r of positions) {
      if (r.parentReqID) {
        const arr = childrenByParent.get(r.parentReqID) || [];
        arr.push(r);
        childrenByParent.set(r.parentReqID, arr);
      }
    }

    const report = pushAccountsWithZeroRecords(
      sortSupportRecords(positions, childrenByParent),
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

    // Defensive: build the full set of parentReqIDs that have children at
    // all (not just in this result set) so `sortMarketingRecords` can skip
    // legacy parents that still carry an `assignedToRef` alongside real
    // child assignments.
    const parentIdsWithChildren = new Set<string>(
      (await RequirementModel.distinct("parentReqID", {
        parentReqID: { $exists: true, $ne: "" },
      })) as string[]
    );

    const assigned = sortMarketingRecords(positions, parentIdsWithChildren);
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
      // Only count parents + legacy standalone — child assignments are
      // per-marketer work records, not independent requirements, so
      // counting them would inflate the dashboard stat.
      RequirementModel.countDocuments({
        $or: [
          { parentReqID: { $exists: false } },
          { parentReqID: null },
          { parentReqID: "" },
        ],
      } as Record<string, unknown>),
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
