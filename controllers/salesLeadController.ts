import { Request, Response } from "express";
import { SalesLeadModel } from "../models/salesLead";
import { SalesLead } from "../interface/salesLead";
import { PaginateResult } from "../interface/pagination";

export const getSalesLeads = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const query: any = { ...req.query };
    delete query.page;
    delete query.limit;
    const total = await SalesLeadModel.countDocuments(query);

    const salesLeads = await SalesLeadModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    const results: PaginateResult<SalesLead> = {};

    if (endIndex < total) {
      results.next = {
        page: page + 1,
        limit: limit,
      };
    }

    if (startIndex > 0) {
      results.previous = {
        page: page - 1,
        limit: limit,
      };
    }
    results.results = salesLeads;
    results.currentPage = page;
    results.totalPages = Math.ceil(total / limit);

    res.status(200).json({ data: results });
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
    const { name, comment } = req.body;
    if (!name || !comment) {
      res.status(404).json({ message: "name or comment is missing" });
      return
    }
    const updatedSalesLead = await SalesLeadModel.findOneAndUpdate(
      { _id: salesLeadId },
      { $push: { comments: { name, comment } } },
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
export const updateComment = async (req: Request, res: Response) => {
  try {
    const { salesLeadId, commentId } = req.params;
    const { comment } = req.body;

    const updatedSalesLead = await SalesLeadModel.findByIdAndUpdate(
      salesLeadId,
      {
        $set: {
          "comments.$[elem].comment": comment,
        },
      },
      {
        arrayFilters: [{ "elem._id": commentId }],
        new: true,
      }
    );

    if (!updatedSalesLead) {
      res.status(404).json({ message: "Post or Comment not found" });
      return;
    }

    res.status(200).json({ data: updatedSalesLead });
  } catch (error) {
    res.status(500).json({ error });
  }
};
export const deleteComment = async (req: Request, res: Response) => {
  try {
    const { salesLeadId, commentId } = req.params;

    const updatedSalesLead = await SalesLeadModel.findByIdAndUpdate(
      salesLeadId,
      {
        $pull: {
          comments: { _id: commentId },
        },
      },
      {
        new: true,
      }
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
