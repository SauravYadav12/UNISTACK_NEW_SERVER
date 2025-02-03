export type PositionReport = {
  [key in RequirementStatus]?: number;
} & {
  name?: string;
  totalPositions?: number;
};
export type MarketingReport = {
  [key in RequirementStatus]?: number;
} & {
  marketingPerson?: string;
  totalAssigned?: number;
};
export type InterviewReport = {
  [key in InterviewStatus]?: number;
} & {
  name?: string;
  totalInterviews?: number;
};

export type RequirementStatus =
  | "New Working"
  | "Submitted"
  | "Interviewed"
  | "Cancelled"
  | "Project Active"
  | "Project Inactive";
export type InterviewStatus =
  | "Interview Confirm"
  | "Interview Tentative"
  | "Interview Cancelled"
  | "Interview Completed"
  | "Interview Re-Scheduled";
