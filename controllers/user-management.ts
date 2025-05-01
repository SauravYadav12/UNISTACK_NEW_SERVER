import { Request, Response } from "express";
import { UserModel } from "../models/userModel";
import { handleDateQuery } from "../utils/utils";

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const q = handleDateQuery(req.query);
    const users = await UserModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      users,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const user = await UserModel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.status(200).json({
      status: "success",
      user,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};
