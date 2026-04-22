import { Request, Response } from "express";
import { InterviewModel } from "../models/interviewModel";
import { RequirementModel } from "../models/requirementModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage, sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { syncReqStatusFromInterview } from "../utils/syncRequirementStatus";

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
    await syncReqStatusFromInterview({
      reqID: interview.reqID,
      interviewStatus: interview.interviewStatus,
      intResult: interview.intResult,
      updatedBy: interview.updatedBy,
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
    await syncReqStatusFromInterview({
      reqID: data.reqID,
      interviewStatus: data.interviewStatus,
      intResult: data.intResult,
      updatedBy: data.updatedBy,
    });
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
