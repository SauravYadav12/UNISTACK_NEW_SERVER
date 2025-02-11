import { Request, Response } from "express";
import { UserProfileModel } from "../models/userProfile";

export const getUserProfiles = async (req: Request, res: Response) => {
  try {
    const userProfiles = await UserProfileModel.find(req.query).sort({
      createdAt: -1,
    });

    res.status(200).json({ data: userProfiles });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const createUserProfile = async (req: Request, res: Response) => {
  try {
    let totalProfiles = await UserProfileModel.countDocuments();
    const date = new Date();
    const month =
      date.getMonth() < 10 ? `0${date.getMonth()}` : date.getMonth();
    const day = date.getDate() < 10 ? `0${date.getDate()}` : date.getDate();
    const counter =
      totalProfiles < 10 ? `0${totalProfiles}` : `${totalProfiles}`;
    const employeeId = `UNI-${day}-${month}-${date.getFullYear()}/${counter}`;
    const newUserProfile = new UserProfileModel({
      ...req.body,
      employeeId,
    });

    const savedUserProfile = await newUserProfile.save();
    res.status(201).json({ data: savedUserProfile });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const updateUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updatedUserProfile = await UserProfileModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (!updatedUserProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: updatedUserProfile });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const deleteUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedUserProfile = await UserProfileModel.findByIdAndDelete(id);

    if (!deletedUserProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: "User Profile deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getUserProfileById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const userProfile = await UserProfileModel.findById(id);

    if (!userProfile) {
      res.status(404).json({ error: "User Profile not found" });
      return;
    }

    res.status(200).json({ data: userProfile });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};
