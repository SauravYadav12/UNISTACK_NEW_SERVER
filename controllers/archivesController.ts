import { Request, Response } from "express";
import { archiveInterview, archiveRequirement } from "../db/archiveInstance";
import { queryTransform } from "../utils/utils";

export const getAllArchiveRequirements = async (
  req: Request,
  res: Response
) => {
  try {
    const q = queryTransform(req.query);

    const requirements = await archiveRequirement
      .find(q)
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({
      status: "success",
      data: requirements,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

export const getAllArchiveInterviews = async (req: Request, res: Response) => {
  try {
    const q = queryTransform(req.query);
    const interviews = await archiveInterview
      .find(q)
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json({
      status: "success",
      data: interviews,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};
