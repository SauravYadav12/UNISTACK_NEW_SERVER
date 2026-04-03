import z from "zod";
import { salaryStructure } from "../../interface/salary.structure";

export const payslipSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  user: z.string().min(1, "User ID is required"),
  profile: z.string().min(1, "Profile ID is required"),
  month: z
    .number()
    .min(1, "Month is required")
    .max(12, "Month must be between 1 and 12"),
  year: z.number().min(1900, "Year must be greater than 1900"),
  email: z.email("Invalid email address"),
  dob: z.string().min(1, "Date of Birth is required"),
  name: z.string().min(1, "Name is required"),
  workingDays: z.number().min(0, "Working days must be at least 0"),
  designation: z.string().min(1, "Designation is required"),
  dateOfJoining: z.string().min(1, "Date of Joining is required"),
  salaryStructure: salaryStructure,
});


export type PayslipPayload = z.infer<typeof payslipSchema>;