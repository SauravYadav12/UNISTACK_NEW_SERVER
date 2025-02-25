import { Request, Response } from "express";
import { archiveInterview, archiveRequirement } from "../db/archiveInstance";
import { paginationInstance, PaginationResult } from "../utils/pagination";

export const getAllArchiveRequirements = async (
  req: Request,
  res: Response
) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      archiveRequirement
    );
    const { startIndex, query, limit } = options;
    const requirements = await archiveRequirement
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .toArray();

    const data: PaginationResult<any> = { ...instance, results: requirements };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

export const getAllArchiveInterviews = async (req: Request, res: Response) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      archiveInterview
    );
    const { startIndex, query, limit } = options;
    const interview = await archiveInterview
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .toArray();

    const data: PaginationResult<any> = { ...instance, results: interview };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};
