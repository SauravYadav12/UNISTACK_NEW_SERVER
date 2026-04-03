import { Request, Response } from "express";
import { payslipSchema } from "../utils/zodSchema/payslip.validator";
import { UserProfileModel } from "../models/userProfileModel";
import { Schema } from "mongoose";
import Payslip from "../models/payslipModel";
import { paginationInstance } from "../utils/pagination";

export default class PayslipController {
  static create = async (req: Request, res: Response) => {
    try {
      const { data, error } = payslipSchema.safeParse(req.body);

      if (error) {
        return res
          .status(400)
          .json({ message: "Invalid request data", error: error.issues });
      }

      const { employeeId, user, profile } = data;

      const isProfileExists = await UserProfileModel.findOne({
        employeeId,
        user: new Schema.Types.ObjectId(user),
        _id: new Schema.Types.ObjectId(profile),
      });

      if (!isProfileExists) {
        return res.status(404).json({ message: "User profile not found" });
      }

      const payslip = await Payslip.create(data);

      res.status(201).json(payslip);
    } catch (error) {
      res.status(500).json({ message: "Error creating payslip", error });
    }
  };

  static getPayslipById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const payslip = await Payslip.findById(id);

      res.status(200).json(payslip);
    } catch (error) {
      res.status(500).json({ message: "Error fetching payslip", error });
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const { instance, options } = await paginationInstance(
        req.query,
        Payslip.collection,
      );
      const { startIndex, query, limit } = options;
      const payslips = await Payslip.find(query).skip(startIndex).limit(limit);
      const data = { ...instance, results: payslips };
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ message: "Error fetching payslips", error });
    }
  };
}
