import { Request, Response } from "express";
import { ArchiveInterview, ArchiveRequirement } from "../db/archiveInstance";
import { paginationInstance, PaginationResult } from "../utils/pagination";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";

export const getAllArchiveRequirements = async (
  req: Request,
  res: Response
) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.requirement);
    const { options, instance } = await paginationInstance(
      iQuery,
      ArchiveRequirement
    );
    const { startIndex, query, limit } = options;
    const requirements = await ArchiveRequirement.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    const data: PaginationResult<unknown> = { ...instance, results: requirements };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error fetching archived requirements:", error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const getAllArchiveInterviews = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.interview);
    const { options, instance } = await paginationInstance(
      iQuery,
      ArchiveInterview
    );
    const { startIndex, query, limit } = options;
    const interview = await ArchiveInterview.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    const data: PaginationResult<unknown> = { ...instance, results: interview };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error fetching archived interviews:", error);
    res.status(400).json({
      status: "failed",
    });
  }
};
