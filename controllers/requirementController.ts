import { Request, Response } from "express";
import { updateArrayFields } from "../utils/arrayUpdateOprations";
import { paginationInstance } from "../utils/pagination";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { handleDateQuery, sequenceId } from "../utils/utils";
import { RequirementModel } from "../models/requirementModel";
import RequirementLogModel from "../models/requirement.log.model";

export const getAllRrequirements = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.requirement);
    const { options, instance } = await paginationInstance(
      iQuery,
      RequirementModel,
    );
    const { startIndex, limit, query } = options;
    const requirements = await RequirementModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: requirements };
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

export const createRequirement = async (req: Request, res: Response) => {
  try {
    req.body.reqID = await sequenceId(RequirementModel, "reqID", "REQ");
    const data = await RequirementModel.create(req.body);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const updateRequirement = async (req: Request, res: Response) => {
  try {
    const arrayFields = ["mComment"];

    const updateOps = updateArrayFields(req, arrayFields);

    const nonArrayUpdates = { ...req.body };

    const updatedReq = await RequirementModel.findByIdAndUpdate(
      req.params.id,
      { ...nonArrayUpdates, ...updateOps },
      { new: true },
    );

    res.status(200).json({
      status: "success",
      data: updatedReq,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const deleteRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deletedRequirement = await RequirementModel.findByIdAndDelete(id);

    if (!deletedRequirement) {
      res.status(404).json({
        status: "failed",
        message: "RequirementModel not found",
      });
      return;
    }

    res.status(200).json({
      status: "success",
      message: "RequirementModel deleted successfully",
      deletedRequirement,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};

export const getRequirementLog = async (req: Request, res: Response) => {
  try {
    const q = handleDateQuery(req.query);
    const data = await RequirementLogModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const createRequirementLog = async (req: Request, res: Response) => {
  try {
    const data = await RequirementLogModel.create(req.body);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const requirementsCounts = async (req: Request, res: Response) => {
  try {
    let { date } = req.query;

    if (!date) {
      res.status(400).json({
        status: "failed",
        message: "Date query is required",
      });
      return;
    }

    if (!Array.isArray(date)) {
      if (typeof date === "string") {
        date = [date];
      } else if (typeof date === "object") {
        date = Object.values(date).filter((d) => typeof d === "string");
      }
    }

    date = date?.filter((d) => !!d);

    const countPromises = date.map(async (dateStr) => {
      try {
        const parsedDate = new Date(dateStr as string);
        
        if (isNaN(parsedDate.getTime())) {
          throw new Error(`Invalid date: ${dateStr}`);
        }

        const startOfDay = new Date(parsedDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(parsedDate);
        endOfDay.setHours(23, 59, 59, 999);

        const count = await RequirementModel.countDocuments({
          createdAt: {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        });

        return {
          date: dateStr as string,
          count: count,
        };
      } catch (error) {
        console.error(`Error processing date ${dateStr}:`, error);
        return {
          date: String(dateStr),
          count: 0,
        };
      }
    });

    const counts = await Promise.all(countPromises);

    res.status(200).json({
      status: "success",
      data: counts,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: error,
    });
  }
};
