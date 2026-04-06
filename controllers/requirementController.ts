import { Request, Response } from "express";
import { updateArrayFields } from "../utils/arrayUpdateOprations";
import { paginationInstance } from "../utils/pagination";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import {
  getErrorMessage,
  handleDateQuery,
  handlePaginationQuery,
  sequenceId,
} from "../utils/utils";
import { RequirementModel } from "../models/requirementModel";
import RequirementLogModel from "../models/requirement.log.model";
import { ArchiveRequirement } from "../db/archiveInstance";
import {
  extractRequirementFromContent,
  RequirementExtractionValidationError,
} from "../services/requirementExtractionService";

export const extractRequirementData = async (req: Request, res: Response) => {
  try {
    const { content, instruction } = req.body as {
      content?: unknown;
      instruction?: unknown;
    };

    const data = await extractRequirementFromContent({
      content: typeof content === "string" ? content : "",
      instruction:
        instruction === undefined || instruction === null
          ? undefined
          : String(instruction),
    });

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    if (error instanceof RequirementExtractionValidationError) {
      res.status(400).json({
        status: "failed",
        error: error.message,
        details: error.details,
      });
      return;
    }
    console.error("Error extracting requirement:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

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
    console.error("Error fetching requirements:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
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
  } catch (error) {
    console.error("Error deleting requirement:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
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
      error: getErrorMessage(error),
    });
  }
};

export const requirementsCounts = async (req: Request, res: Response) => {
  try {
    const {
      date,
      timezone = "Asia/Kolkata",
      archive = false,
      ...filters
    } = req.query;
    let iDates = date;
    const { query } = handlePaginationQuery(filters);

    if (!iDates) {
      res.status(400).json({
        status: "failed",
        message: "Date query is required",
      });
      return;
    }

    if (typeof timezone !== "string") {
      res.status(400).json({
        status: "failed",
        message: "Timezone must be a string",
      });
      return;
    }

    if (!Array.isArray(iDates)) {
      if (typeof iDates === "string") {
        iDates = [iDates];
      } else if (typeof iDates === "object") {
        iDates = Object.values(iDates).filter((d) => typeof d === "string");
      }
    }

    iDates = iDates?.filter((d) => !!d);

    iDates.forEach((d) => {
      const dateString = d as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        res.status(400).json({
          status: "failed",
          message: `Date must be in YYYY-MM-DD format: ${dateString}`,
        });
        return;
      }

      const parsedDate = new Date(dateString);
      if (isNaN(parsedDate.getTime())) {
        res
          .status(400)
          .json({ status: "failed", message: `Invalid date: ${dateString}` });
        return;
      }
    });

    const dateObjects = iDates.map((d) => new Date(d as string));
    const minInputDate = new Date(
      Math.min(...dateObjects.map((d) => d.getTime())),
    );
    const maxInputDate = new Date(
      Math.max(...dateObjects.map((d) => d.getTime())),
    );

    const minDate = new Date(minInputDate.getTime() - 24 * 60 * 60 * 1000);
    const maxDate = new Date(maxInputDate.getTime() + 24 * 60 * 60 * 1000);

    const aggregationResult = await (
      archive.toString().toLowerCase() === "true"
        ? ArchiveRequirement
        : RequirementModel
    ).aggregate([
      {
        $match: {
          ...query,
          createdAt: {
            $gte: minDate,
            $lte: maxDate,
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: timezone,
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          date: "$_id",
          count: 1,
          _id: 0,
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    const countMap = new Map();

    aggregationResult.forEach((item) => {
      countMap.set(item.date, item.count);
    });

    const counts = iDates.map((dateStr) => {
      const dateString = dateStr as string;
      return {
        date: dateString,
        count: countMap.get(dateString) || 0,
      };
    });

    res.status(200).json({
      status: "success",
      data: counts,
      timezone: timezone,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: error,
    });
  }
};
