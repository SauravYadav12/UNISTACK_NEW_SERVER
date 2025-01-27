export interface SalesLead {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  message: string;
  status: SalesLeadStatus;
  comments: SalesLeadComment[];
}

export type SalesLeadStatus =
  | "New"
  | "Contacted"
  | "HotLead"
  | "Cold Lead"
  | "Converted"
  | "Closed"
  | "Bad Lead";

export interface SalesLeadComment {
  name: string;
  commentBy:string;
  date: string;
  comment: string;
}
