import z from "zod";

const salaryStructure = z.object({
  basicSalary: z.number().min(0, "Basic salary must be positive"),
  hra: z.number().min(0, "HRA must be positive"),
  medicalAllowance: z.number().min(0, "Medical allowance must be positive"),
  travelAllowance: z.number().min(0, "Travel allowance must be positive"),
  foodAllowance: z.number().min(0, "Food allowance must be positive"),
  mobileAllowance: z.number().min(0, "Mobile allowance must be positive"),
  bonus: z
    .array(
      z.object({
        label: z.string().min(1, "Bonus label is required"),
        amount: z.number().min(0, "Bonus amount must be positive"),
      }),
    )
    .optional(),
  otherAllowances: z.number().min(0, "Other allowances must be positive"),
  incomeTax: z.number().min(0, "Income tax must be positive"),
  pfContribution: z.number().min(0, "PF contribution must be positive"),
  esiContribution: z.number().min(0, "ESI contribution must be positive"),
  professionalTax: z.number().min(0, "Professional tax must be positive"),
  lopDeduction: z.number().min(0, "LOP deduction must be positive"),
  otherDeductions: z.number().min(0, "Other deductions must be positive"), 
  employerPfContribution: z.number().min(0, "Employer PF must be positive"),
  employerEsiContribution: z.number().min(0, "Employer ESI must be positive"),
  gratuity: z.number().min(0, "Gratuity must be positive"),
});
type SalaryStructure = z.infer<typeof salaryStructure>;

export { salaryStructure, SalaryStructure };
