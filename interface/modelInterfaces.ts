import { UserShift, WorkLocation } from './constants';
import { UserRole } from '../enums/UserEnum';
import { AttendanceStatus } from '../models/attendance';

// Teams Interface
export interface ITeam {
  _id: string;
  teamId: string;
  teamName?: string;
  teckStack?: string;
  developerName?: string;
  createdBy?: string;
  rank?: number;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

// User Interface
export interface IUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  password: string;
  role?: UserRole[];
  shift?: UserShift;
  workLocation?: WorkLocation;
  gender: string;
  active?: boolean;
  premium?: boolean;
  plan?: 'free' | 'platinum' | 'business';
  corpName: string;
  canEdit?: boolean;
  otp?: string;
  otpExpiry?: string;
  activity?: Array<{
    loggedInAt?: string;
    loggedOutAt?: string;
    location?: string;
    ip?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// Attendance Interface
export interface IAttendance {
  _id: string;
  userRef: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status?: AttendanceStatus;
  createdAt: string;
  updatedAt: string;
}

// Requirement Interface
export interface IRequirement {
  _id: string;
  reqID: string;
  reqStatus?: string;
  nextStep?: string;
  appliedFor?: string;
  appliedForRef?: string;
  assignedTo?: string;
  assignedToRef?: string;
  resume?: string;
  resumeUpload?: string;
  rate?: unknown[];
  taxType?: unknown[];
  remote?: unknown[];
  duration?: unknown[];
  mComment?: unknown[];
  clientCompany?: string;
  clientWebsite?: string;
  clientAddress?: string;
  clientPerson?: string;
  clientPhone?: string;
  clientEmail?: string;
  primeVendorCompany?: string;
  primeVendorWebsite?: string;
  primeVendorName?: string;
  primeVendorPhone?: string;
  primeVendorEmail?: string;
  vendorCompany?: string;
  vendorWebsite?: string;
  vendorPersonName?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  reqEnteredDate?: string;
  gotReqFrom?: string;
  gotOnResume?: string;
  jobTitle?: string;
  employementType?: string;
  jobPortalLink?: string;
  reqEnteredBy?: string;
  reqEnteredByRef: string;
  reqKeywords?: string;
  jobDescription?: string;
  recordOwner?: string;
  primaryTech?: string;
  secondaryTech?: string;
  updatedBy?: string;
  interviews?: unknown[];
  primaryTechStack?: string;
  isDuplicate?: string;
  duplicateWith?: string;
  parentReqID?: string;
  childSuffix?: string;
  /** Response-only flag — set in `getAllRrequirements` for parent rows that
   *  have at least one child. Never persisted on the document. */
  hasChildren?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Consultant Interface
export interface IConsultant {
  _id: string;
  consultantId: string;
  consultantName?: string;
  consultantStatus?: string;
  visaStatus?: string;
  currentAddress?: string;
  previousAddress?: string;
  email?: string;
  phone?: string;
  skypeId?: string;
  dob?: string;
  ssn?: string;
  dlNo?: string;
  degree?: string;
  university?: string;
  yearPassing?: string;
  timeZone?: string;
  projects?: Array<{
    projectNumber?: string;
    projectName?: string;
    projectCity?: string;
    projectState?: string;
    projectStartDate?: string;
    projectEndDate?: string;
    projectDescription?: string;
    isCurrent?: boolean;
    projectDomain?: string;
  }>;
  psuedoName?: string;
  getVisa?: string;
  cameToUsYear?: string;
  originCountry?: string;
  lookingToChange?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// Leave Interface
export interface ILeave {
  _id: string;
  userRef: string;
  name: string;
  startDate: string;
  endDate: string;
  reason?: string;
  type?: 'Sick Leave' | 'Casual Leave' | 'Annual Leave' | 'Other';
  status?: 'Pending' | 'Approved' | 'Rejected';
  respondBy?: string;
  respondedAt?: string;
  rejectionReason?: string;
  isHalfDay?: boolean;
  halfDayType?: 'First Half' | 'Second Half';
  attachments?: string[];
  emailRefIds?: string[];
  paymentCategory?: 'Paid' | 'Unpaid' | 'Medical';
  leaveType?: string;
  splitBreakdown?: Array<{ leaveType: string; days: number }>;
  createdAt: string;
  updatedAt: string;
}

// Holiday Interface
export interface IHoliday {
  _id: string;
  name?: string;
  description?: string;
  fromDate: string;
  toDate: string;
  isHalfDay?: boolean;
  halfDayType?: 'First Half' | 'Second Half';
  country?: 'IN' | 'US' | 'ALL';
  source?: 'manual' | 'system';
  externalId?: string;
  noticeSentAt?: string;
  noticeSentTo?: number;
  createdAt: string;
  updatedAt: string;
}

// Interview Interface
export interface IInterview {
  _id: string;
  intId: string;
  interviewDate?: string;
  interviewTime?: string;
  interviewType?: string;
  interviewStatus?: string;
  intResult?: string;
  consultant?: string;
  consultantRef?: string;
  marketingPerson?: string;
  marketingPersonRef?: string;
  vendorCompany?: string;
  primeVendorCompany?: string;
  tentativeReason?: string;
  gitHubLink?: string;
  codeLink?: string;
  result?: string;
  subjectLine?: string;
  interviewMode?: string;
  interviewLink?: string;
  interviewFocus?: string;
  jobDescription?: string;
  interviewFeedback?: string;
  taxType?: unknown[];
  clientName?: string;
  duration?: unknown[];
  candidateName?: string;
  candidateRef?: string;
  teckStack?: string;
  developerName?: string;
  recordOwner?: string;
  reqID?: string;
  recordId?: string;
  interviewRound?: string;
  interviewViaMode?: string;
  meetingType?: string;
  interviewDuration?: string;
  interviewWith?: string;
  jobTitle?: string;
  timeShift?: string;
  timeZone?: string;
  updatedBy?: string;
  remarks?: string;
  specialNote?: string;
  script?: string;
  createdAt: string;
  updatedAt: string;
}

// Access Control Interface (Flexible schema)
export interface IAccessControl {
  _id: string;
  [key: string]: unknown; // Since it uses strict: false
  createdAt: string;
  updatedAt: string;
}

// Vendor Interface  
export interface IVendor {
  _id: string;
  testID: string;
  interviewDate?: string;
  interviewTime?: string;
  interviewType?: string;
  interviewStatus?: string;
  intResult?: string;
  consultant?: string;
  consultantRef?: string;
  marketingPerson?: string;
  marketingPersonRef?: string;
  vendorCompany?: string;
  primeVendorCompany?: string;
  tentativeReason?: string;
  gitHubLink?: string;
  codeLink?: string;
  result?: string;
  subjectLine?: string;
  interviewMode?: string;
  interviewLink?: string;
  interviewFocus?: string;
  jobDescription?: string;
  interviewFeedback?: string;
  taxType?: unknown[];
  clientName?: string;
  duration?: unknown[];
  candidateName?: string;
  candidateRef?: string;
  teckStack?: string;
  developerName?: string;
  recordOwner?: string;
  reqID?: string;
  recordId?: string;
  interviewRound?: string;
  interviewViaMode?: string;
  meetingType?: string;
  interviewDuration?: string;
  interviewWith?: string;
  jobTitle?: string;
  timeShift?: string;
  timeZone?: string;
  updatedBy?: string;
  remarks?: string;
  specialNote?: string;
  script?: string;
  createdAt: string;
  updatedAt: string;
}

// Requirement Log Interface
export interface IRequirementLog {
  _id: string;
  requirementRef: string;
  operation: 'create' | 'update' | 'delete';
  userName: string;
  userRef: string;
  oldData?: Partial<unknown>;
  newData: Partial<unknown>;
  createdAt: string;
  updatedAt: string;
}

// Chess Lead — subscription-sales pipeline for chess academies.
// Fields mirror the sales-team's spreadsheet plus a Priority chip
// (Hot / Warm / Cold) so the dashboard can surface hot leads, and
// a nextFollowUpDate so we can pull a "due today / overdue" tile.
export type ChessLeadStatus =
  | 'New'
  | 'Renewed'
  | 'Not renewed'
  | 'Not converted';
export type ChessLeadPriority = 'Hot' | 'Warm' | 'Cold';

export interface IChessLead {
  _id: string;
  /** Sequential display id: LEAD-01, LEAD-02, … */
  leadId: string;
  academyName: string;
  subscriptionDate?: string;    // YYYY-MM-DD
  totalIds?: number;
  mobileNumber?: string;
  /** @deprecated — kept for old rows only; new writes populate the
   *  country / state / city triplet. Server search still greps this
   *  field so legacy leads remain findable by the free-text filter. */
  stateOrCity?: string;
  /** Country / state / city — sourced from the client's country-state-city
   *  ISO dataset. Iso codes stored alongside display names so edit
   *  re-cascades without a name-lookup fallback. */
  country?: string;
  countryIso?: string;
  state?: string;
  stateIso?: string;
  city?: string;
  pricingPerId?: number;
  /** GST rate applied on top of totalIds × pricingPerId. Defaults to 18
   *  (the standard SaaS rate in India); admins can override per lead in
   *  case a client sits under a different bracket. */
  gstPercent?: number;
  status: ChessLeadStatus;
  priority: ChessLeadPriority;
  reason?: string;
  nextFollowUpDate?: string;    // YYYY-MM-DD
  /** Date the client's subscription was most recently renewed. Distinct
   *  from `subscriptionDate` (the original signup). Optional. */
  lastRenewalDate?: string;     // YYYY-MM-DD
  /** Salesperson who created the lead. Kept for auditing — the team
   *  pool is shared, so ownership isn't enforced on reads. */
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IChessLeadLog {
  _id: string;
  leadRef: string;
  leadId: string;
  operation: 'create' | 'update' | 'delete';
  userName: string;
  userRef: string;
  oldData?: Partial<unknown>;
  newData: Partial<unknown>;
  createdAt: string;
  updatedAt: string;
}

// Interview Log Interface — same shape as the requirement log, just keyed
// to interview docs. Activity tracking for the interview drawer.
export interface IInterviewLog {
  _id: string;
  interviewRef: string;
  operation: 'create' | 'update' | 'delete';
  userName: string;
  userRef: string;
  oldData?: Partial<unknown>;
  newData: Partial<unknown>;
  createdAt: string;
  updatedAt: string;
}

// Sales Lead Comment Interface (used in SalesLead)
export interface ISalesLeadComment {
  _id: string;
  name: string;
  commentBy: string;
  comment: string;
  date?: string;
}

// Organization Interface
export interface IOrganization {
  _id: string;
  orgId: string;
  name: string;
  shortCode: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  einNumber?: string;
  /** Public image URL (PNG/JPG). When set, invoice PDFs render the logo in
   *  the header instead of the plain-text org name. */
  logoUrl?: string;
  active: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// Project + Billing shared types
export type PaymentTermsPreset = 'Net 15' | 'Net 30' | 'Net 45' | 'Net 60' | 'Custom';
export type InvoiceStatus = 'Draft' | 'Raised' | 'Paid' | 'Due';
export type TimesheetApprovalStatus = 'Pending' | 'Requested' | 'Approved' | 'Rejected';
export type DocStepStatus = 'Pending' | 'Done';

export interface IDocStep {
  status: DocStepStatus;
  completedOn?: string;
  notes?: string;
  attachmentUrl?: string;
}

// Project Interface
export type ProjectStatus = 'Active' | 'On Hold' | 'Ended' | 'Terminated';
export type ContractScope = 'client' | 'vendor' | 'primeVendor' | 'other';

export interface IProjectAdditionalDetail {
  _id?: string;
  key: string;
  value: string;
  addedBy?: string;
  addedAt?: string;
}

export interface IProjectContract {
  _id?: string;
  scope: ContractScope;
  label?: string;
  url: string;
  fileName: string;
  sizeBytes?: number;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface IProject {
  _id: string;
  projectId: string;
  reqID: string;
  requirementRef?: string;

  // Organization (required going forward; optional on the TS type for legacy rows)
  organizationRef?: string;
  organizationName?: string;
  organizationShortCode?: string;
  organizationEIN?: string;
  organizationLogoUrl?: string;
  organizationAddress?: string;
  organizationEmail?: string;
  organizationWebsite?: string;

  // Seeded snapshot from Requirement (frozen at creation)
  jobTitle?: string;
  consultant?: string;
  clientCompany?: string;
  clientWebsite?: string;
  clientAddress?: string;
  clientPerson?: string;
  clientPhone?: string;
  clientEmail?: string;
  primeVendorCompany?: string;
  primeVendorWebsite?: string;
  primeVendorName?: string;
  primeVendorPhone?: string;
  primeVendorEmail?: string;
  primeVendorAddress?: string;
  vendorCompany?: string;
  vendorWebsite?: string;
  vendorPersonName?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  vendorAddress?: string;
  rate?: unknown[];
  taxType?: unknown[];
  duration?: unknown[];

  /** Which party the invoice is billed to. Drives the Bill-To rendering. */
  billToCustomer?: 'Client' | 'Vendor' | 'Prime Vendor';

  // Project-owned fields
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  notes?: string;

  // Billing metadata
  billingUnit?: 'hourly';
  paymentTerms?: { preset: PaymentTermsPreset; days: number };
  taxPercent?: number;
  invoiceRecipients?: {
    client: boolean;
    vendor: boolean;
    primeVendor: boolean;
    customEmails: string[];
  };

  documentation?: {
    bgc: IDocStep;
    contractSigned: IDocStep;
    paymentTermsAccepted: IDocStep;
    onboarding: IDocStep;
    extraNotes?: string;
  };

  additionalDetails?: IProjectAdditionalDetail[];
  contracts?: IProjectContract[];

  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// Timesheet + Approval + Invoice interfaces
export interface ITimesheetEntry {
  date: string;       // YYYY-MM-DD
  hours: number;
}

export interface ITimesheetScreenshotSlot {
  _id?: string;
  /** Free-text label the admin can rename — defaults to the auto-derived
   *  "Week of …" label but accepts any text (e.g. "June 2026 timesheet"
   *  for clients that accept monthly proofs). */
  label: string;
}

export interface ITimesheetScreenshot {
  _id?: string;
  /** Binds the screenshot to a slot in `Timesheet.screenshotSlots`.
   *  Optional only for legacy rows persisted before the custom-slot
   *  model — those still carry weekStart/weekEnd/weekLabel directly. */
  slotId?: string;
  /** ISO start/end of the week the screenshot covers, keeps uploads organised.
   *  Optional now that slots can be free-text — kept on the schema for
   *  back-compat with existing rows. */
  weekStart?: string;  // YYYY-MM-DD
  weekEnd?: string;    // YYYY-MM-DD
  /** Human label admins can eyeball: e.g. "Week of Apr 1 – Apr 7". */
  weekLabel?: string;
  url: string;
  fileName: string;
  sizeBytes?: number;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface ITimesheet {
  _id: string;
  projectRef: string;
  projectId: string;
  organizationRef: string;
  periodMonth: string; // YYYY-MM
  entries: ITimesheetEntry[]; // one entry per day of month, length 28-31
  totalHours: number;
  /** True once every day of the month has a non-null hours value recorded. */
  allFilled: boolean;
  /** True when the admin has explicitly marked the month "complete". This
   *  gates "Submit for approval" — you can't submit until you've confirmed
   *  the month is finalised. Resets to false whenever entries change. */
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
  /** Approved-timesheet screenshots vendors attach to the invoice email. */
  screenshots?: ITimesheetScreenshot[];
  /** User-defined upload-row slots. Empty when the timesheet has never been
   *  touched; once anything is added/edited/uploaded the slot list becomes
   *  canonical. Default rows are computed by the client from `periodMonth`
   *  until the first persistence. */
  screenshotSlots?: ITimesheetScreenshotSlot[];
  filledBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ITimesheetApproval {
  _id: string;
  projectRef: string;
  projectId: string;
  organizationRef: string;
  periodMonth: string;
  status: TimesheetApprovalStatus;
  timesheetIds: string[];
  totalHoursAtSubmission?: number;
  requestedAt?: string;
  requestedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  generatedInvoiceRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IInvoiceLineItem {
  _id?: string;
  description: string;
  hours?: number;
  rate?: number;
  amount: number;
}

export interface IInvoice {
  _id: string;
  invoiceNumber: string;
  projectRef: string;
  projectId: string;
  organizationRef: string;
  organizationName: string;
  periodMonth: string;

  lineItems: IInvoiceLineItem[];
  subtotal: number;
  taxLabel?: string;
  taxPercent: number;
  taxAmount: number;
  total: number;
  currency: string;

  status: InvoiceStatus;
  issueDate?: string;
  dueDate?: string;
  paidOn?: string;
  paymentReference?: string;
  paymentNotes?: string;

  emailedTo: string[];
  /** CC list from the most recent send. Stored separately from emailedTo so
   *  the Resend dialog can faithfully restore the To/CC split (and not paste
   *  CC addresses into the To field). */
  emailedCc?: string[];
  /** Last-sent subject line. Restored into the Resend dialog. */
  emailedSubject?: string;
  /** Last-sent body text (plain — the brand HTML shell is re-applied by the
   *  email service on each send). */
  emailedBody?: string;
  emailedAt?: string;
  dueNotifiedAt?: string;

  pdfUrl?: string;
  notes?: string;
  approvalRef: string;

  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IEmailTemplateBlock {
  subject: string;
  heading: string;
  bodyLead: string;
  bodyDetails: string;
  signOff: string;
}

export interface IInvoiceEmailSettings {
  _id: string;
  timesheetApprovalRequest: IEmailTemplateBlock;
  raised: IEmailTemplateBlock;
  due: IEmailTemplateBlock;
  updatedAt: string;
  updatedBy?: string;
}

// Re-export existing interfaces for convenience
export { SalesLead, SalesLeadStatus, SalesLeadComment } from './salesLead';
export { UserProfile, Address, BankDetails, ProfileEmail } from './userProfile';
export { UserShift, WorkLocation } from './constants';
export { PositionReport, MarketingReport, InterviewReport, RequirementStatus, InterviewStatus } from './interfaces';