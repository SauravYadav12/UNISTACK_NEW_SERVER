import { Schema } from "mongoose";
import type { SalaryStructure } from "../interface/salary.structure";

const salaryStructureSchema = new Schema<SalaryStructure>(
  {
    basicSalary: { type: Number, default: 0 },
    hra: { type: Number, default: 0 },
    medicalAllowance: { type: Number, default: 0 },
    travelAllowance: { type: Number, default: 0 },
    foodAllowance: { type: Number, default: 0 },
    mobileAllowance: { type: Number, default: 0 },
    otherAllowances: { type: Number, default: 0 },
    incomeTax: { type: Number, default: 0 },
    pfContribution: { type: Number, default: 0 },
    esiContribution: { type: Number, default: 0 },
    professionalTax: { type: Number, default: 0 },
    lopDeduction: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    employerPfContribution: { type: Number, default: 0 },
    employerEsiContribution: { type: Number, default: 0 },
    gratuity: { type: Number, default: 0 },
    bonus: {
      type: [
        {
          label: { type: String, required: true },
          amount: { type: Number, required: true },
        },
      ],
      default: [],
    },
  },
  { _id: false },
);

export default salaryStructureSchema;
