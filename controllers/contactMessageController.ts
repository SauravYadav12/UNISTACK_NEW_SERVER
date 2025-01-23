import { Request, Response } from "express";
import { ContactMessageModel } from "../models/contactMessage";
import { ContactMessage } from "../interface/contactMessage";

export const getContactMessages = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const query: any = { ...req.query };
    delete query.page;
    delete query.limit;
    const total = await ContactMessageModel.countDocuments(query);

    const contactUs = await ContactMessageModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    const results: GetContactUsResult = {};

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
    results.results = contactUs;
    results.currentPage = page;
    results.totalPages = Math.ceil(total / limit);

    res.status(200).json({ data: results });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};
export const getContactMessageById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const message = await ContactMessageModel.findById(id);

    if (!message) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    res.status(200).json({ data: message });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const createContactMessage = async (req: Request, res: Response) => {
  try {
    const newMessage = new ContactMessageModel({
      ...req.body,
    });

    const savedMessage = await newMessage.save();
    res.status(201).json({ data: savedMessage });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateContactMessage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updatedMessage = await ContactMessageModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (!updatedMessage) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    res.status(200).json({ data: updatedMessage });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const deleteContactMessage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedMessage = await ContactMessageModel.findByIdAndDelete(id);

    if (!deletedMessage) {
      res.status(404).json({ error: "failed to delete" });
      return;
    }

    res.status(200).json({ data: "deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export interface GetContactUsResult {
  next?: { page: number; limit: number };
  previous?: { page: number; limit: number };
  results?: ContactMessage[];
  currentPage?: number;
  totalPages?: number;
}
