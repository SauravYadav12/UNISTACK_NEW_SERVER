import { Request, Response } from "express";
import { paginationInstance } from "../utils/pagination";
import { LeaveModel } from "../models/leaveModel";

export const getLeaves = async (req: Request, res: Response) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      LeaveModel
    );
    const { startIndex, query, limit } = options;
    const leaves = await LeaveModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: leaves };

    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const createLeave = async (req: Request, res: Response) => {
  try {
    const newLeave = new LeaveModel({
      ...req.body,
    });

    const data = await newLeave.save();
    res.status(201).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updatedLeave = await LeaveModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updatedLeave) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    res.status(200).json({ data: updatedLeave });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const deleteLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const data = await LeaveModel.findByIdAndDelete(id);

    if (!data) {
      res.status(404).json({ error: "failed to delete" });
      return;
    }

    res.status(200).json({ data: "deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};
