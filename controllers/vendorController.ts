import { Request, Response } from "express";
import { VendorModel } from "../models/vendorModel";
import { paginationInstance } from "../utils/pagination";
import { sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";

export const getAllInterviews = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(
      req.query,
      searchableFields.vendorInterview
    );
    const { options, instance } = await paginationInstance(iQuery, VendorModel);
    const { startIndex, query, limit } = options;
    const interviews = await VendorModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: interviews };
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

export const createInterview = async (req: Request, res: Response) => {
  try {
    req.body.testID = await sequenceId(VendorModel, "testID", "TEST");
    const interview = await VendorModel.create(req.body);
    res.status(200).json({
      status: "success",
      data: interview,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const updateInterview = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const data = await VendorModel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      res.status(404).json({
        status: "failed",
        message: "Vendor Interview not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const deleteInterview = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const deleteInterview = await VendorModel.findByIdAndDelete(id);
    if (!deleteInterview) {
      res.status(404).json({
        status: "failed",
        message: "Vendor Interview not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      message: "Vendor Interview deleted successfully",
      deleteInterview,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
