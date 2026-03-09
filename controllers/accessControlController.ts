import { Request, Response } from "express";
import { AccessControlModel } from "../models/accessControlModel";

export async function getAccessControl(req: Request, res: Response) {
  try {
    let data = await AccessControlModel.findOne({});
    if (!data) {
      data = await AccessControlModel.create({});
    }
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error fetching access control data:", error);
    res.status(400).json({
      status: "failed",
    });
  }
}
export async function updateAccessControl(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const data = await AccessControlModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.error("Error updating access control data:", error);
    res.status(400).json({
      status: "failed",
    });
  }
}
