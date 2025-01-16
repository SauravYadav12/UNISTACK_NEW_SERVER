import { Request, Response } from "express";
import { UserProfileModel } from "../models/userProfile";
import {} from "../models/userProfile";
import { UserProfile } from "../interface/userProfile";

export const getUserProfiles = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const query: any = { ...req.query };
    delete query.page;
    delete query.limit;
    const total = await UserProfileModel.countDocuments(query);

    const userProfiles = await UserProfileModel.find(query)
      .limit(limit)
      .skip(startIndex)
      .exec();

    const results: GetUserProfilesResult = {};

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
    results.results = userProfiles;
    results.currentPage = page;
    results.totalPages = Math.ceil(total / limit);

    res.status(200).json({ data: results });
  } catch (error) {
    // console.error(error);
    res.status(500).json({ error: error });
  }
};

export const createUserProfile = async (req: Request, res: Response) => {
  try {
    let totalProfiles = await UserProfileModel.countDocuments();
    const date = new Date();
    const counter =
      totalProfiles < 10 ? `0${totalProfiles}` : `${totalProfiles}`;
    const employeeId = `UNI-${date.getMonth()}-${date.getFullYear()}/${counter}`;
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
    // console.error(error);
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
    // console.error(error);
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
    // console.error(error);
    res.status(500).json({ error: error });
  }
};

export interface GetUserProfilesResult {
  next?: { page: number; limit: number };
  previous?: { page: number; limit: number };
  results?: UserProfile[];
  currentPage?: number;
  totalPages?: number;
}
