import { Request, Response } from "express";
import { ConsultantModel } from "../models/consultantModel";
import { paginationInstance } from "../utils/pagination";
import { sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";

export const getAllConsultants = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.consultant);
    const { options, instance } = await paginationInstance(
      iQuery,
      ConsultantModel
    );
    const { startIndex, query, limit } = options;
    const consultant = await ConsultantModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: consultant };
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

export const createConsultant = async (req: Request, res: Response) => {
  try {
    req.body.consultantId = await sequenceId(
      ConsultantModel,
      "consultantId",
      "CNS"
    );
    const consultant = await ConsultantModel.create(req.body);
    res.status(200).json({
      status: "success",
      data: consultant,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const updateConsultant = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const data = await ConsultantModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
      }
    );
    if (!data) {
      res.status(404).json({
        status: "failed",
        message: "Consultant not found",
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

export const deleteConsultant = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const deleteConsultant = await ConsultantModel.findByIdAndDelete(id);
    if (!deleteConsultant) {
      res.status(404).json({
        status: "failed",
        message: "Consultant not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      message: "Consultant deleted successfully",
      deleteConsultant,
    });
  } catch (error: any) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
