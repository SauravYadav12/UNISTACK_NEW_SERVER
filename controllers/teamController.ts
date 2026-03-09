import { Request, Response } from "express";
import { TeamsModel } from "../models/teamsModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage, sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";

export const getAllTeams = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.team);
    const { options, instance } = await paginationInstance(iQuery, TeamsModel);
    const { startIndex, query, limit } = options;
    const teams = await TeamsModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: teams };

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error fetching teams:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  try {
    req.body.teamId = await sequenceId(TeamsModel, "teamId", "TEAM");
    const team = await TeamsModel.create(req.body);
    res.status(200).json({
      status: "success",
      data: team,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const data = await TeamsModel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      res.status(404).json({
        status: "failed",
        message: "Team not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const deleteTeam = await TeamsModel.findByIdAndDelete(id);
    if (!deleteTeam) {
      res.status(404).json({
        status: "failed",
        message: "Team not found",
      });
      return;
    }
    res.status(200).json({
      status: "success",
      message: "Team deleted successfully",
      deleteTeam,
    });
  } catch (error) {
    console.error("Error deleting team:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};
