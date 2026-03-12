import { Request, Response } from "express";
import {
  SalaryStructure,
  salaryStructure,
} from "../interface/salary.structure";
import { paginationInstance } from "../utils/pagination";
import { UserProfileModel } from "../models/userProfileModel";
import omitEmpty from "omit-empty";
export class SalaryStructureController {
  static select =
    "salaryStructure _id email employeeId name photo dob phoneNumber user";
  static save= async (req: Request, res: Response) => {
    const { id } = req.params;
    const { error, data } = salaryStructure.partial().safeParse(req.body);
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const salaryStr =
      (await UserProfileModel.findById(id).select("salaryStructure").lean())
        ?.salaryStructure || {};

    const payload = omitEmpty({ ...salaryStr, ...data }) as SalaryStructure;

    const updatedUser = await UserProfileModel.findByIdAndUpdate(
      id,
      { salaryStructure: payload },
      { new: true },
    ).select(this.select);

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ data: updatedUser.salaryStructure });
  }

  static get = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await UserProfileModel.findById(id).select(this.select);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({ data: user });
  };

  static getAll = async (req: Request, res: Response) => {
    const { instance, options } = await paginationInstance(
      req.query,
      UserProfileModel,
    );
    const { startIndex, query, limit } = options;
    const users = await UserProfileModel.find(query)
      .skip(startIndex)
      .limit(limit)
      .select(this.select);
    const data = { ...instance, results: users };
    res.status(200).json({ data });
  };
}
