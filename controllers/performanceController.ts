import { Request, Response } from "express";
import { Types } from "mongoose";
import { RequirementModel } from "../models/requirementModel";
import { InterviewModel } from "../models/interviewModel";
import { UserModel } from "../models/userModel";
import {
  DEFAULT_MARKETING_WEIGHTS,
  DEFAULT_SUPPORT_WEIGHTS,
  PerformanceRole,
  PerformanceWeightsModel,
  getWeights,
} from "../models/performanceWeightsModel";
import {
  computeMarketingMetrics,
  computeSupportMetrics,
  Contributors,
  MarketingMetrics,
  ReqForScoring,
  InterviewForScoring,
  scoreMarketing,
  scoreSupport,
  ScoreResult,
  SupportMetrics,
} from "../utils/scoring";
import { myDate } from "../utils/dateUtil";
import { getErrorMessage } from "../utils/utils";
import { UserRole } from "../enums/UserEnum";

interface LeaderboardRow {
  user: {
    _id: string;
    name: string;
    email: string;
    active: boolean;
  };
  metrics: MarketingMetrics | SupportMetrics;
  breakdown: ScoreResult["breakdown"];
  contributors: Contributors;
  score: number;
  rawTotal: number;
  rank: number;
}

/** Build the display name safely. */
function displayName(u: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  const n = `${u.firstName || ""} ${u.lastName || ""}`.trim();
  return n || u.email;
}

/** Resolve { from, to } from query params — same handling as the existing
 *  reportController so the client can reuse its date picker as-is. */
function resolveWindow(req: Request): { from: Date; to: Date } {
  const { fromDate, toDate } = req.query as {
    fromDate?: string;
    toDate?: string;
  };
  if (fromDate || toDate) return myDate(fromDate, toDate);
  // Default: current calendar month.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

/** GET /performance/marketing — leaderboard rows for the marketing role. */
export const getMarketingLeaderboard = async (
  req: Request,
  res: Response
) => {
  try {
    const { from, to } = resolveWindow(req);
    const weightsDoc = await getWeights("marketing");
    const weights = weightsDoc.weights;

    const marketers = await UserModel.find({
      role: UserRole.Marketing,
      active: true,
    })
      .select("firstName lastName email active")
      .lean();

    // Build the set of reqIDs that are parents-with-children. Legacy parents
    // may still carry a stale `assignedToRef` from the pre-split world; we
    // must exclude those from the marketer's credit since the real work is
    // being done on the children.
    const parentIdsWithChildren = await RequirementModel.distinct(
      "parentReqID",
      { parentReqID: { $exists: true, $ne: "" } }
    );

    // Pull every relevant req + interview owned by any marketer — no
    // `createdAt` window filter. Scoring filters by event timestamps
    // (`_perf*At ∈ [from, to]`) internally; a req created last year whose
    // Complete fires this month must still surface, so we can't prune by
    // creation date here. For the org scale this is fine (thousands, not
    // millions).
    const [reqs, interviews] = await Promise.all([
      RequirementModel.find({
        assignedToRef: { $in: marketers.map((m) => m._id) },
        // Keep children (they have parentReqID) and legacy standalones
        // (their reqID isn't referenced as a parentReqID by any other doc).
        // Drop parents-with-children via reqID not-in set.
        $or: [
          { parentReqID: { $exists: true, $ne: "" } },
          parentIdsWithChildren.length > 0
            ? { reqID: { $nin: parentIdsWithChildren } }
            : { reqID: { $exists: true } },
        ],
      })
        .select(
          "reqID reqStatus assignedToRef parentReqID updatedAt createdAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt _perfStaleSubmissionFiredAt _perfUnworkedPenaltyFiredAt"
        )
        .lean(),
      InterviewModel.find({
        marketingPersonRef: { $in: marketers.map((m) => m._id) },
      })
        .select(
          "intId reqID interviewStatus interviewWith interviewDate marketingPersonRef createdAt _perfConfirmedAt _perfCompletedAt _perfOfferAt _perfStaleConfirmFiredAt",
        )
        .lean(),
    ]);

    const rows: LeaderboardRow[] = marketers.map((u) => {
      const uid = String(u._id);
      const userReqs = (reqs as ReqForScoring[]).filter(
        (r) => String(r.assignedToRef) === uid
      );
      const userInterviews = (interviews as InterviewForScoring[]).filter(
        (i) => String(i.marketingPersonRef) === uid
      );
      const { metrics, contributors } = computeMarketingMetrics({
        assignedReqs: userReqs,
        interviews: userInterviews,
        from,
        to,
      });
      const scored = scoreMarketing(metrics, weights);
      return {
        user: {
          _id: uid,
          name: displayName(u),
          email: u.email,
          active: !!u.active,
        },
        metrics,
        breakdown: scored.breakdown,
        contributors,
        score: scored.score,
        rawTotal: scored.rawTotal,
        rank: 0, // filled below
      };
    });

    // Rank by score desc; ties broken by completed → confirmed → submissions.
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const am = a.metrics as MarketingMetrics;
      const bm = b.metrics as MarketingMetrics;
      if (bm.interviewsCompleted !== am.interviewsCompleted)
        return bm.interviewsCompleted - am.interviewsCompleted;
      if (bm.interviewsConfirmed !== am.interviewsConfirmed)
        return bm.interviewsConfirmed - am.interviewsConfirmed;
      return bm.submissions - am.submissions;
    });
    rows.forEach((r, i) => (r.rank = i + 1));

    res.status(200).json({
      status: "success",
      data: {
        window: { from, to },
        weights,
        rows,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** GET /performance/support — leaderboard rows for the support role. */
export const getSupportLeaderboard = async (req: Request, res: Response) => {
  try {
    const { from, to } = resolveWindow(req);
    const weightsDoc = await getWeights("support");
    const weights = weightsDoc.weights;

    const supporters = await UserModel.find({
      role: UserRole.Support,
      active: true,
    })
      .select("firstName lastName email active")
      .lean();

    // Intentionally fetch BOTH parents and children: the scorer partitions
    // internally so a parent is credited when any child reaches the milestone.
    // `parentReqID` and `childSuffix` must be in the select for that to work.
    // No `createdAt` filter — scoring filters by `_perf*At ∈ [from, to]`
    // for each milestone, so a req entered last year whose Project Active
    // fires this month still surfaces correctly.
    const reqs = await RequirementModel.find({
      reqEnteredByRef: { $in: supporters.map((s) => s._id) },
    })
      .select(
        "reqID reqStatus reqEnteredByRef parentReqID childSuffix isDuplicate updatedAt createdAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt _perfUnprogressedPenaltyFiredAt"
      )
      .lean();

    // Build the set of reqIDs that have at least one client-facing interview
    // (Confirmed OR Completed). Used to gate `entriesReachedInterviewed` —
    // a parent only gets credit when an actual client interview happened on
    // itself or one of its children.
    const reqIDsInWindow = reqs
      .map((r) => r.reqID)
      .filter((x): x is string => !!x);
    const clientInterviews = await InterviewModel.find({
      reqID: { $in: reqIDsInWindow },
      interviewWith: "Client",
      interviewStatus: { $in: ["Interview Confirm", "Interview Completed"] },
    })
      .select("reqID")
      .lean();
    const clientInterviewReqIDs = new Set(
      clientInterviews.map((i) => i.reqID as string).filter(Boolean),
    );

    const rows: LeaderboardRow[] = supporters.map((u) => {
      const uid = String(u._id);
      const userReqs = (reqs as ReqForScoring[]).filter(
        (r) => String(r.reqEnteredByRef) === uid
      );
      const { metrics, contributors } = computeSupportMetrics({
        enteredReqs: userReqs,
        clientInterviewReqIDs,
        from,
        to,
      });
      const scored = scoreSupport(metrics, weights);
      return {
        user: {
          _id: uid,
          name: displayName(u),
          email: u.email,
          active: !!u.active,
        },
        metrics,
        breakdown: scored.breakdown,
        contributors,
        score: scored.score,
        rawTotal: scored.rawTotal,
        rank: 0,
      };
    });

    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const am = a.metrics as SupportMetrics;
      const bm = b.metrics as SupportMetrics;
      if (bm.entriesReachedProject !== am.entriesReachedProject)
        return bm.entriesReachedProject - am.entriesReachedProject;
      if (bm.entriesReachedInterviewed !== am.entriesReachedInterviewed)
        return bm.entriesReachedInterviewed - am.entriesReachedInterviewed;
      return bm.entriesReachedSubmitted - am.entriesReachedSubmitted;
    });
    rows.forEach((r, i) => (r.rank = i + 1));

    res.status(200).json({
      status: "success",
      data: {
        window: { from, to },
        weights,
        rows,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** GET /performance/weights — returns both role weights + audit. */
export const getAllWeights = async (_req: Request, res: Response) => {
  try {
    const [m, s] = await Promise.all([
      getWeights("marketing"),
      getWeights("support"),
    ]);
    res.status(200).json({
      status: "success",
      data: {
        marketing: {
          weights: m.weights,
          defaults: DEFAULT_MARKETING_WEIGHTS,
          audit: m.audit,
          updatedAt: m.updatedAt,
        },
        support: {
          weights: s.weights,
          defaults: DEFAULT_SUPPORT_WEIGHTS,
          audit: s.audit,
          updatedAt: s.updatedAt,
        },
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** PATCH /performance/weights — super-admin only. Body:
 *   { role: 'marketing' | 'support', weights: {...}, reason?: string }
 */
export const updateWeights = async (req: Request, res: Response) => {
  try {
    const { role, weights: nextRaw, reason } = req.body as {
      role?: PerformanceRole;
      weights?: Record<string, unknown>;
      reason?: string;
    };
    if (role !== "marketing" && role !== "support") {
      res
        .status(400)
        .json({ status: "failed", message: "role must be 'marketing' or 'support'" });
      return;
    }
    if (!nextRaw || typeof nextRaw !== "object") {
      res
        .status(400)
        .json({ status: "failed", message: "weights object is required" });
      return;
    }

    // Coerce all weight values to finite numbers; drop anything else so the
    // audit log isn't polluted with garbage inputs.
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(nextRaw)) {
      const n = Number(v);
      if (Number.isFinite(n)) next[k] = n;
    }

    const doc = await getWeights(role);
    const before = { ...doc.weights };
    doc.weights = { ...doc.weights, ...next };
    const user = req.user as
      | {
          _id?: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          email?: string;
        }
      | undefined;
    doc.updatedBy = user?._id;
    doc.audit.push({
      changedBy: user?._id,
      changedByName: user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
        : undefined,
      changedAt: new Date(),
      before,
      after: { ...doc.weights },
      reason,
    });
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** POST /performance/weights/reset — wipe to factory defaults (super-admin). */
export const resetWeights = async (req: Request, res: Response) => {
  try {
    const { role } = req.body as { role?: PerformanceRole };
    if (role !== "marketing" && role !== "support") {
      res
        .status(400)
        .json({ status: "failed", message: "role is required" });
      return;
    }
    const doc = await getWeights(role);
    const before = { ...doc.weights };
    doc.weights =
      role === "marketing" ? DEFAULT_MARKETING_WEIGHTS : DEFAULT_SUPPORT_WEIGHTS;
    const user = req.user as
      | { _id?: Types.ObjectId; firstName?: string; lastName?: string; email?: string }
      | undefined;
    doc.updatedBy = user?._id;
    doc.audit.push({
      changedBy: user?._id,
      changedByName: user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
        : undefined,
      changedAt: new Date(),
      before,
      after: { ...doc.weights },
      reason: "reset-to-defaults",
    });
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

// Re-export for the controllers-index barrel if the app uses one.
export { PerformanceWeightsModel };
