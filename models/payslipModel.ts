import mongoose from "mongoose";
import salaryStructureSchema from "./salaryStructureSchema";
import { PayslipPayload } from "../utils/zodSchema/payslip.validator";

const payslipSchema = new mongoose.Schema<PayslipPayload>({
  employeeId: {
    type: String,
    required: true,
  },
  user: {
    type: String,
    required: true,
  },
  profile: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  dob: {
    type: Date,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  workingDays: {
    type: Number,
    required: true,
  },
  designation: {
    type: String,
    required: true,
  },
  dateOfJoining: {
    type: Date,
    required: true,
  },
  month: {
    type: Number,
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  salaryStructure: {
    type: salaryStructureSchema,
    required: true,
  },
}, { timestamps: true });

const Payslip = mongoose.model<PayslipPayload>("Payslip", payslipSchema);

export default Payslip;
