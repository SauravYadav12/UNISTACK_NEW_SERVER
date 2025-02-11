import { Request, Response } from "express";
import { SalesLeadModel } from "../models/salesLead";

export const getSalesLeads = async (req: Request, res: Response) => {
  try {
    const salesLeads = await SalesLeadModel.find(req.query).sort({
      createdAt: -1,
    });

    res.status(200).json({ data: salesLeads });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const getSalesLeadsById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const salesLead = await SalesLeadModel.findById(id);

    if (!salesLead) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    res.status(200).json({ data: salesLead });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const createSalesLead = async (req: Request, res: Response) => {
  try {
    const newSalesLead = new SalesLeadModel({
      ...req.body,
    });

    const savedSalesLead = await newSalesLead.save();
    res.status(201).json({ data: savedSalesLead });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateSalesLead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updatedSalesLead = await SalesLeadModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (!updatedSalesLead) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    res.status(200).json({ data: updatedSalesLead });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const deleteSalesLead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedSalesLead = await SalesLeadModel.findByIdAndDelete(id);

    if (!deletedSalesLead) {
      res.status(404).json({ error: "failed to delete" });
      return;
    }

    res.status(200).json({ data: "deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const createComment = async (req: Request, res: Response) => {
  try {
    const { salesLeadId } = req.params;
    const { name, comment, commentBy } = req.body;
    if (!name || !comment || !commentBy) {
      res
        .status(404)
        .json({ message: "name or comment or commentBy is missing" });
      return;
    }
    const updatedSalesLead = await SalesLeadModel.findOneAndUpdate(
      { _id: salesLeadId },
      { $push: { comments: { name, comment, commentBy } } },
      { new: true }
    );

    if (!updatedSalesLead) {
      res.status(404).json({ message: "Post not found" });
      return;
    }

    res.status(200).json({ data: updatedSalesLead });
  } catch (error) {
    res.status(500).json({ error });
  }
};
