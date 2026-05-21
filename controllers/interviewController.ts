import { Request, Response } from "express";
import { InterviewModel } from "../models/interviewModel";
import { RequirementModel } from "../models/requirementModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage, handleDateQuery, sequenceId } from "../utils/utils";
import InterviewLogModel from "../models/interview.log.model";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { syncReqStatusFromInterview } from "../utils/syncRequirementStatus";
import { emitNotification } from "../services/notificationService";
import { UserDoc, UserModel } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";
import { stampInterviewMilestones } from "../utils/perfStamps";

/**
 * Resolve the support person who entered the requirement linked to an
 * interview. Walks parent if needed so a child-bound interview still
 * notifies the support owner. Returns null if there's no link.
 */
async function resolveReqOwners(reqID?: string | null): Promise<{
  reqEnteredByRef?: unknown;
  parentReqID: string;
} | null> {
  if (!reqID) return null;
  const r = await RequirementModel.findOne({ reqID })
    .select("reqID parentReqID reqEnteredByRef")
    .lean();
  if (!r) return null;
  if (r.parentReqID) {
    const parent = await RequirementModel.findOne({ reqID: r.parentReqID })
      .select("reqID reqEnteredByRef")
      .lean();
    return {
      reqEnteredByRef: parent?.reqEnteredByRef ?? r.reqEnteredByRef,
      parentReqID: r.parentReqID,
    };
  }
  return { reqEnteredByRef: r.reqEnteredByRef, parentReqID: r.reqID };
}

function actorPayload(req: Request) {
  const u = req.user as UserDoc | undefined;
  if (!u) return undefined;
  return {
    _id: u._id,
    name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
  };
}

export const getAllInterviews = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.interview);
    const { options, instance } = await paginationInstance(
      iQuery,
      InterviewModel
    );
    const { startIndex, query, limit } = options;
    const interview = await InterviewModel.find(query)
      .sort({ interviewDate: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    const data = { ...instance, results: interview };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error fetching interviews:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

/**
 * GET /interviews-by-parent/:reqID
 *
 * Returns every interview that belongs to a parent requirement OR any of its
 * child assignments. Legacy / standalone rows just return their own
 * interviews (children collection is empty). Used by RequirementMeta on the
 * parent drawer to show per-marketer interview pipelines in one view.
 */
export const getInterviewsForParent = async (req: Request, res: Response) => {
  try {
    const reqID = typeof req.params.reqID === "string" ? req.params.reqID : "";
    if (!reqID) {
      res
        .status(400)
        .json({ status: "failed", message: "reqID path param is required" });
      return;
    }

    // Fetch the direct children so we can include their interviews too.
    const children = await RequirementModel.find({ parentReqID: reqID })
      .select("reqID childSuffix assignedTo assignedToRef")
      .lean();

    const allReqIDs = [reqID, ...children.map((c) => c.reqID)];
    const interviews = await InterviewModel.find({ reqID: { $in: allReqIDs } })
      .sort({ interviewDate: -1, createdAt: -1 })
      .lean();

    res.status(200).json({
      status: "success",
      data: {
        parentReqID: reqID,
        children,
        results: interviews,
      },
    });
  } catch (error) {
    console.error("Error fetching interviews-for-parent:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const createInterview = async (req: Request, res: Response) => {
  try {
    // Parent-with-children guard: interviews must be created against a
    // specific child (or legacy standalone), not a parent that has spawned
    // child assignments. A parent has stale reqStatus — routing an interview
    // at it would flip the parent's status via syncReqStatusFromInterview and
    // bypass the real per-marketer child record.
    const targetReqID =
      typeof req.body?.reqID === "string" ? req.body.reqID.trim() : "";
    if (targetReqID) {
      const hasChildren = await RequirementModel.exists({
        parentReqID: targetReqID,
      });
      if (hasChildren) {
        res.status(400).json({
          status: "failed",
          message: `${targetReqID} is a parent requirement with multiple marketer assignments. Create the interview against the specific child (e.g. ${targetReqID}-A).`,
        });
        return;
      }
    }

    req.body.intId = await sequenceId(InterviewModel, "intId", "INT");
    const interview = await InterviewModel.create(req.body);

    // Monotonic scoring: if the new interview was created already in
    // Confirm/Complete/Offer (admin entered it post-hoc), stamp the
    // corresponding milestone fields. No-op for the common "Scheduled"
    // initial state.
    void stampInterviewMilestones(interview._id, {
      interviewWith: interview.interviewWith,
      interviewStatus: interview.interviewStatus,
      intResult: interview.intResult,
    });

    await syncReqStatusFromInterview({
      reqID: interview.reqID,
      interviewStatus: interview.interviewStatus,
      intResult: interview.intResult,
      updatedBy: interview.updatedBy,
    });

    // Event 6 — confirm to the marketer + ping the support owner that an
    // interview was booked on their requirement. The actor is excluded by
    // default, so if the marketer booked it themselves they don't ping
    // themselves; but the support owner still gets it.
    const owners = await resolveReqOwners(interview.reqID);
    void emitNotification({
      recipients: [
        interview.marketingPersonRef,
        owners?.reqEnteredByRef,
      ].filter(Boolean) as Array<unknown> as Array<string>,
      type: "INTERVIEW_CREATED",
      title: `Interview ${interview.intId} booked${
        interview.interviewWith ? ` (${interview.interviewWith})` : ""
      }`,
      body: `Interview booked on ${interview.reqID}.`,
      link: { kind: "interview", intId: interview.intId, reqID: interview.reqID },
      actor: actorPayload(req),
    });

    res.status(200).json({
      status: "success",
      data: interview,
    });
  } catch (error) {
    console.error("Error creating interview:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const updateInterview = async (req: Request, res: Response) => {
  try {
    // Capture the previous state so we can detect transitions for events 7-9.
    const before = await InterviewModel.findById(req.params.id).lean();
    const data = await InterviewModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
      }
    );
    if (!data) {
      res.status(404).json({
        status: "failed",
        message: "Interview not found",
      });
      return;
    }
    // Monotonic scoring: stamp the newly-reached milestone on the
    // interview itself. Idempotent — second update on the same status
    // is a no-op via the `$exists: false` guard in `stampInterviewMilestones`.
    void stampInterviewMilestones(data._id, {
      interviewWith: data.interviewWith,
      interviewStatus: data.interviewStatus,
      intResult: data.intResult,
    });

    await syncReqStatusFromInterview({
      reqID: data.reqID,
      interviewStatus: data.interviewStatus,
      intResult: data.intResult,
      updatedBy: data.updatedBy,
    });

    // Events 7-9 — only fire on actual transitions. The status/result emit
    // is gated to client-facing interviews (matches the performance rules)
    // so vendor / IMP prep rounds don't spam the bell.
    if (before && data.interviewWith === "Client") {
      const owners = await resolveReqOwners(data.reqID);
      const baseRecipients = [
        data.marketingPersonRef,
        owners?.reqEnteredByRef,
      ].filter(Boolean) as Array<unknown> as Array<string>;

      // Event 7 — Confirm.
      if (
        before.interviewStatus !== "Interview Confirm" &&
        data.interviewStatus === "Interview Confirm"
      ) {
        void emitNotification({
          recipients: baseRecipients,
          type: "INTERVIEW_CONFIRMED",
          title: `Interview ${data.intId} confirmed`,
          body: `${data.intId} (${data.reqID}) is now Interview Confirm.`,
          link: { kind: "interview", intId: data.intId, reqID: data.reqID },
          actor: actorPayload(req),
        });
      }

      // Event 8 — Completed.
      if (
        before.interviewStatus !== "Interview Completed" &&
        data.interviewStatus === "Interview Completed"
      ) {
        void emitNotification({
          recipients: baseRecipients,
          type: "INTERVIEW_COMPLETED",
          title: `Interview ${data.intId} completed`,
          body: `${data.intId} (${data.reqID}) marked Interview Completed.`,
          link: { kind: "interview", intId: data.intId, reqID: data.reqID },
          actor: actorPayload(req),
        });
      }

      // Event 9 — Offer (super-admins also get pinged, deal closed).
      if (before.intResult !== "Offer" && data.intResult === "Offer") {
        const superAdminIds = await UserModel.distinct("_id", {
          role: UserRole.SuperAdmin,
        });
        void emitNotification({
          recipients: [...baseRecipients, ...superAdminIds],
          type: "INTERVIEW_OFFER",
          title: `Offer on ${data.intId}!`,
          body: `${data.intId} (${data.reqID}) returned an Offer result.`,
          link: { kind: "interview", intId: data.intId, reqID: data.reqID },
          actor: actorPayload(req),
        });
      }
    }

    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const deleteInterview = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const deleteInterview = await InterviewModel.findByIdAndDelete(id);
    if (!deleteInterview) {
      res.status(404).json({
        status: "failed",
        message: "Interview not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      message: "Interview deleted successfully",
      deleteInterview,
    });
  } catch (error) {
    console.error("Error deleting interview:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

// ── Activity log ─────────────────────────────────────────────────────────
//
// Mirrors `requirementController.{getRequirementLog,createRequirementLog}`
// exactly. The client posts an explicit log entry after a successful
// create / update — the server doesn't auto-write logs on every mutation.
// Supports two read modes:
//   - `interviewRef=<id>` → logs for one interview
//   - `reqID=<reqID>` (incl. children) → all interview logs that hang off
//     a parent requirement or any of its children. Lets the requirement
//     drawer show a unified per-parent interview-history view alongside
//     its own log table.

export const getInterviewLog = async (req: Request, res: Response) => {
  try {
    // Mode 1 — by `reqID`: aggregate every interview attached to a parent
    // (or its children) and return all of their logs. The requirement
    // drawer uses this to show interview activity alongside its own.
    const reqID =
      typeof req.query.reqID === "string" ? req.query.reqID.trim() : "";

    if (reqID) {
      // Resolve every reqID in the parent+children family.
      const docs = await RequirementModel.find({
        $or: [{ reqID }, { parentReqID: reqID }],
      })
        .select("reqID")
        .lean();
      const reqIDs = docs.map((d) => d.reqID).filter(Boolean) as string[];
      if (reqIDs.length === 0) {
        res.status(200).json({ status: "success", data: [] });
        return;
      }
      // Find all interviews tied to any of those reqIDs.
      const interviews = await InterviewModel.find({
        reqID: { $in: reqIDs },
      })
        .select("_id")
        .lean();
      const interviewIds = interviews.map((i) => i._id);
      if (interviewIds.length === 0) {
        res.status(200).json({ status: "success", data: [] });
        return;
      }
      const data = await InterviewLogModel.find({
        interviewRef: { $in: interviewIds },
      }).sort({ createdAt: -1 });
      res.status(200).json({ status: "success", data });
      return;
    }

    // Mode 2 — by direct `interviewRef` (or date-window filters).
    const q = handleDateQuery(req.query as Record<string, unknown>);
    const data = await InterviewLogModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const createInterviewLog = async (req: Request, res: Response) => {
  try {
    const data = await InterviewLogModel.create(req.body);
    res.status(200).json({ status: "success", data });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};
