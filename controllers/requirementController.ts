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
    let { date, timezone = "Asia/Kolkata" } = req.query;

    if (!date) {
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

    if (!Array.isArray(date)) {
      if (typeof date === "string") {
        date = [date];
      } else if (typeof date === "object") {
        date = Object.values(date).filter((d) => typeof d === "string");
      }
    }

    date = date?.filter((d) => !!d);

    date.forEach((d) => {
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

    const dateObjects = date.map((d) => new Date(d as string));
    const minInputDate = new Date(
      Math.min(...dateObjects.map((d) => d.getTime())),
    );
    const maxInputDate = new Date(
      Math.max(...dateObjects.map((d) => d.getTime())),
    );

    const minDate = new Date(minInputDate.getTime() - 24 * 60 * 60 * 1000);
    const maxDate = new Date(maxInputDate.getTime() + 24 * 60 * 60 * 1000);

    const aggregationResult = await RequirementModel.aggregate([
      {
        $match: {
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

    const counts = date.map((dateStr) => {
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
