// Export all interfaces (for plain objects with string _id)
export * from './modelInterfaces';

// Export all document interfaces (for MongoDB documents with ObjectId _id)
export type { TeamDoc } from '../models/teamsModel';
export type { UserDoc } from '../models/userModel';
export type { AttendanceDoc } from '../models/attendance';
export type { RequirementDoc } from '../models/requirementModel';
export type { ConsultantDoc } from '../models/consultantModel';
export type { LeaveDoc } from '../models/leaveModel';
export type { HolidayDoc } from '../models/holidayModel';
export type { InterviewDoc } from '../models/interviewModel';
export type { AccessControlDoc } from '../models/accessControlModel';
export type { VendorDoc } from '../models/vendorModel';
export type { RequirementLogDoc } from '../models/requirement.log.model';
export type { SalesLeadDoc, SalesLeadCommentDoc } from '../models/salesLeadModel';
export type { UserProfileDoc } from '../models/userProfileModel';

// Export existing interfaces
export * from './salesLead';
export * from './userProfile';
export * from './constants';
export * from './interfaces';