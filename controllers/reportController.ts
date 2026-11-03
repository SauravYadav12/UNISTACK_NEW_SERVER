import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
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

// ── Marketing report (activity-by-status-date) ──────────────────────────
// The marketing report shows a position ONCE, in its CURRENT status, dated
// by when it entered that status (its most recent status change). Each of
// these four statuses has a set-once `_perf*At` stamp that records exactly
// that moment; the report filters/dates on the stamp for the position's
// current status. (No stored timestamp exists for older data, so this is
// accurate going forward — see getMarketingReport.) This is used ONLY by the
// reports; no other view's date behavior changes.
const marketingReportStatusMeta: {
  status: RequirementStatus;
  stamp: keyof RequirementDoc;
}[] = [
  { status: "Submission in progress", stamp: "_perfInProgressAt" },
  { status: "Submitted", stamp: "_perfSubmittedAt" },
  { status: "Interviewed", stamp: "_perfInterviewedAt" },
  { status: "Cancelled", stamp: "_perfCancelledAt" },
];
const marketingReportStatusList: RequirementStatus[] =
  marketingReportStatusMeta.map((m) => m.status);

/**
 * Build the `$or` that selects positions whose CURRENT status is one of the
 * four and whose matching status-date stamp falls inside [from, to].
 * Optionally narrow to a single status (for the drill-down list).
 */
const marketingStatusDateOr = (
  from: Date,
  to: Date,
  status?: string
): FilterQuery<RequirementDoc>[] =>
  marketingReportStatusMeta
    .filter((m) => !status || m.status === status)
    .map(({ status: s, stamp }) => ({
      reqStatus: s,
      [stamp]: { $gte: from, $lte: to },
    })) as FilterQuery<RequirementDoc>[];
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

/**
 * Group the marketing report's status-dated positions by marketer. Each
 * position is already pre-filtered to exactly one of the four statuses (its
 * current status, stamped in-window), so it lands in exactly one bucket and
 * `totalAssigned` is the sum of the four columns (no double-counting).
 */
const sortMarketingByStatusDate = (
  positions: RequirementDoc[],
  parentIdsWithChildren: Set<string>
) => {
  const sortedRecords: MarketingReport[] = [];
  for (const req of positions) {
    // Skip legacy parents that have real child assignments — their children
    // carry the per-marketer counts.
    if (!req.parentReqID && parentIdsWithChildren.has(req.reqID || "")) continue;

    const i = sortedRecords.findIndex((e) => e.name === req.assignedTo);
    const info: MarketingReport = i > -1 ? sortedRecords[i] : {};

    info.name = req.assignedTo;
    info.id = req.assignedToRef?.toString();
    info.totalAssigned = (info.totalAssigned || 0) + 1;

    for (const status of marketingReportStatusList) {
      if (status === req.reqStatus) {
        info[status] = (info[status] || 0) + 1;
        break;
      }
    }

    if (i > -1) sortedRecords[i] = info;
    else sortedRecords.push(info);
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

    // A position shows under the date it ENTERED its current status (not when
    // it was created): current reqStatus ∈ the four buckets AND the matching
    // `_perf*At` stamp falls in [from, to]. Accurate going forward; positions
    // whose status changed before stamping existed simply don't appear until
    // they next move. This date behavior is REPORTS-ONLY.
    const positions = await RequirementModel.find({
      assignedToRef: { $in: ids },
      $or: marketingStatusDateOr(from, to),
    } as FilterQuery<RequirementDoc>);

    // Defensive: build the full set of parentReqIDs that have children at
    // all (not just in this result set) so the grouping can skip legacy
    // parents that still carry an `assignedToRef` alongside real children.
    const parentIdsWithChildren = new Set<string>(
      (await RequirementModel.distinct("parentReqID", {
        parentReqID: { $exists: true, $ne: "" },
      })) as string[]
    );

    const assigned = sortMarketingByStatusDate(positions, parentIdsWithChildren);
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

// GET /reports/marketing/positions?assignedToRef=&status=&fromDate=&toDate=
// The list of positions behind a clicked number in the marketing report:
// the same "current status + its stamp in-window" filter for ONE marketer,
// optionally narrowed to a single status (omit `status` → the person's total
// across all four). Powers the in-app drill-down drawer.
export const getMarketingPositions = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, assignedToRef, status } = req.query as Record<
      string,
      string
    >;
    const { from, to } = myDate(fromDate, toDate);

    if (!assignedToRef) {
      res.status(400).json({ error: "assignedToRef is required" });
      return;
    }
    if (status && !marketingReportStatusList.includes(status as RequirementStatus)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    // Skip legacy parents that have children (consistent with the counts).
    const parentIdsWithChildren = new Set<string>(
      (await RequirementModel.distinct("parentReqID", {
        parentReqID: { $exists: true, $ne: "" },
      })) as string[]
    );

    const positions = await RequirementModel.find({
      assignedToRef,
      $or: marketingStatusDateOr(from, to, status),
    } as FilterQuery<RequirementDoc>)
      .populate("appliedForRef", "firstName lastName")
      .sort({ updatedAt: -1 })
      .lean();

    const data = (positions as unknown as RequirementDoc[]).filter(
      (p) => p.parentReqID || !parentIdsWithChildren.has(p.reqID || "")
    );

    res.status(200).json({ data });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error });
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
