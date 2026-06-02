/**
 * Additional onboarding-document templates (Employment Agreement,
 * Code of Conduct, NDA, Leave & Attendance Policy). Each candidate
 * signs the offer letter PLUS these four to complete onboarding.
 *
 * Single collection, discriminated by `kind`. Exactly one row per
 * kind is `active: true` at a time; editing creates a new active
 * version and marks the previous inactive (same versioning pattern
 * as offerLetterTemplateModel — see that file for why).
 *
 * Each template carries a structured body composed of numbered
 * sections (heading + multi-line body). The renderer auto-formats
 * section headings; the editor lets super-admin reorder, add, and
 * remove sections.
 *
 * Defaults seeded below come straight from the four reference PDFs
 * the founder provided — Unicodez-branded text, 6th-floor Bhopal
 * address, "Anmol Shrivastava, Director" signatory.
 */

import mongoose, { Document, Schema, Types } from "mongoose";

export type OnboardingDocKind =
  | "employment-agreement"
  | "code-of-conduct"
  | "nda"
  | "leave-policy";

export const ONBOARDING_DOC_KINDS: OnboardingDocKind[] = [
  "employment-agreement",
  "code-of-conduct",
  "nda",
  "leave-policy",
];

export const ONBOARDING_DOC_LABELS: Record<OnboardingDocKind, string> = {
  "employment-agreement": "Employment Agreement",
  "code-of-conduct": "Code of Conduct",
  nda: "Non-Disclosure Agreement",
  "leave-policy": "Leave & Attendance Policy",
};

export interface OnboardingDocSection {
  heading: string;
  body: string;
}

export interface OnboardingDocTemplateDoc extends Document {
  _id: Types.ObjectId;
  kind: OnboardingDocKind;
  title: string;
  /** Short paragraph that opens the document, immediately after the
   *  branded header band. Supports {{placeholders}}. */
  preamble: string;
  /** Ordered list of numbered sections rendered as "1. Heading\n body". */
  sections: OnboardingDocSection[];
  /** One-line statement the candidate signs against. */
  acknowledgment: string;
  signatoryName: string;
  signatoryTitle: string;
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  /** Optional director signature image (data URL). Inherits the
   *  offer-letter template's signature when blank — see resolveDirectorSignature
   *  in the controller. */
  directorSignatureDataUrl?: string;
  active: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const sectionSchema = new Schema<OnboardingDocSection>(
  {
    heading: { type: String, required: true },
    body: { type: String, required: true },
  },
  { _id: false },
);

const onboardingDocTemplateSchema = new Schema<OnboardingDocTemplateDoc>(
  {
    kind: {
      type: String,
      required: true,
      enum: ONBOARDING_DOC_KINDS,
      index: true,
    },
    title: { type: String, required: true },
    preamble: { type: String, default: "" },
    sections: { type: [sectionSchema], default: [] },
    acknowledgment: { type: String, default: "" },
    signatoryName: { type: String, default: "Anmol Shrivastava" },
    signatoryTitle: { type: String, default: "Director" },
    companyName: {
      type: String,
      default: "Unicodez Softcorp Private Limited",
    },
    companyAddress: {
      type: String,
      default: "Hall 9/10, Floor 6th, Regal Treasure, Bhopal 462021",
    },
    companyEmail: { type: String, default: "info@unicodez.com" },
    companyWebsite: { type: String, default: "www.unicodez.com" },
    directorSignatureDataUrl: { type: String },
    active: { type: Boolean, default: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

onboardingDocTemplateSchema.index({ kind: 1, active: 1, updatedAt: -1 });

export const OnboardingDocTemplateModel =
  mongoose.model<OnboardingDocTemplateDoc>(
    "OnboardingDocTemplate",
    onboardingDocTemplateSchema,
  );

// ─────────────────────────────────────────────────────────────────────
// Default content (seeded into a fresh DB the first time HR opens any
// of these templates). Mirrors the four reference PDFs the founder
// supplied: Employment Agreement, NDA, Code of Conduct, Leave &
// Attendance Policy. Edit via the template editor; the defaults below
// are only used to populate the very first version of each.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_DOC_TEMPLATES: Record<
  OnboardingDocKind,
  Pick<
    OnboardingDocTemplateDoc,
    "title" | "preamble" | "sections" | "acknowledgment"
  >
> = {
  "employment-agreement": {
    title: "Employee Agreement",
    preamble:
      'This Employee Agreement ("Agreement") is made and entered into between Unicodez Softcorp Pvt. Ltd., a company incorporated under the Companies Act, 2013, having its registered office at 6th Floor, Regal Treasure, Ayodhya Bypass Road, Bhopal MP (the "Company"), AND {{name}} (the "Employee"). The Company and the Employee are hereinafter collectively referred to as the "Parties".',
    sections: [
      {
        heading: "Appointment and Terms of Service",
        body: "The Employee is hereby appointed to the position of {{position}} and agrees to perform all duties assigned by the Company diligently and in compliance with Company policies. The Employee shall not undertake any external employment, consultancy, or business that may conflict with the Company's interests. The Employee shall comply with all applicable laws, regulations, and Company rules as updated from time to time.",
      },
      {
        heading: "Probation Period",
        body: "The Employee shall be on probation for a period of {{probationMonths}} months from the Effective Date. During the probation period the Company may terminate employment with seven (7) days' notice or salary in lieu thereof. If the Employee resigns or discontinues employment during probation, no salary, experience certificate, or relieving letter shall be released. Upon satisfactory performance, the Employee's services shall be confirmed in writing.",
      },
      {
        heading: "Notice Period and Termination",
        body: "Upon confirmation, either Party may terminate this Agreement by providing forty-five (45) days' prior written notice or salary in lieu of such notice. The Company reserves the right to relieve the Employee earlier or adjust the notice period at its discretion. Termination without notice may occur in cases of misconduct, breach of confidentiality, violation of Company policy, or any act detrimental to the Company's interests.",
      },
      {
        heading: "Appraisal",
        body: "Subject to satisfactory performance and Company requirements, the Employee shall be eligible for appraisal and salary revision from the date of confirmation. Appraisals shall be discretionary and aligned with market standards, performance reviews, and management approval.",
      },
      {
        heading: "Confidentiality and Intellectual Property",
        body: "The Employee shall not disclose, misuse, or exploit any Confidential Information belonging to the Company or its clients, during or after employment. All intellectual property, source code, inventions, or business strategies created during employment shall be the sole property of the Company. Confidentiality obligations shall survive termination of employment.",
      },
      {
        heading: "Non-Compete and Non-Solicitation",
        body: "During employment and for a period of twelve (12) months post-termination, the Employee shall not engage in employment with a direct competitor in a similar role, nor solicit clients, vendors, or employees of the Company for personal or competitive gain.",
      },
      {
        heading: "Work Location and Policy",
        body: "Employment is strictly work from office. The Company does not provide any work-from-home facility. The Employee shall adhere to US EST working hours or such shift timings as prescribed by management.",
      },
      {
        heading: "Governing Law and Jurisdiction",
        body: "This Agreement shall be governed by and construed in accordance with the laws of India, with exclusive jurisdiction vested in the courts of Madhya Pradesh.",
      },
      {
        heading: "Entire Agreement",
        body: "This Agreement constitutes the entire understanding between the Parties and supersedes all prior arrangements relating to employment terms.",
      },
    ],
    acknowledgment:
      "I, {{name}}, have read, understood, and agree to the terms of this Employee Agreement.",
  },
  "code-of-conduct": {
    title: "Code of Conduct",
    preamble:
      'This Code of Conduct (the "Policy") is hereby issued by Unicodez Softcorp Pvt. Ltd. (the "Company") and shall be binding upon all full-time employees of the Company. By accepting employment, the Employee acknowledges and agrees to abide by the provisions contained herein.',
    sections: [
      {
        heading: "General Conduct and Obligations",
        body: "Employees shall perform their duties with diligence, integrity, and professionalism, and shall comply with all lawful instructions issued by the Company or its authorized representatives. Employees shall not engage in any conduct that may cause reputational, financial, or legal harm to the Company or its clients. Any act of harassment, discrimination, abusive language, or misconduct shall constitute grounds for disciplinary action up to and including termination. Employees shall strictly comply with client confidentiality requirements, intellectual property protections, and applicable data privacy laws.",
      },
      {
        heading: "Working Hours and Attendance",
        body: "Employees shall adhere to the working hours as prescribed by the Company, including but not limited to the current US EST shift. Attendance shall be recorded through the official Company systems, and repeated tardiness, early logouts, or unauthorized absences may lead to salary deductions and/or disciplinary measures. Public holidays observed shall be in accordance with the official Company holiday calendar.",
      },
      {
        heading: "Use of Company Assets and Systems",
        body: "Company property including laptops, software, communication systems, and other resources shall be used exclusively for official purposes. Employees are liable for the safekeeping and return of Company assets upon cessation of employment. Any unauthorized use, loss, or damage may be recovered by the Company.",
      },
      {
        heading: "Confidentiality and Non-Disclosure",
        body: "Employees shall not disclose, share, or misuse Company or client information without prior written consent. The obligation of confidentiality shall survive termination of employment. A separate Non-Disclosure Agreement shall also be executed, and both instruments shall be read harmoniously.",
      },
      {
        heading: "Disciplinary Action",
        body: "Any violation of this Policy shall render the Employee liable for disciplinary measures including warnings, suspension, salary deductions, or termination of employment. The Company reserves the right to take legal action in cases involving breach of confidentiality, data theft, or misconduct resulting in financial or reputational loss.",
      },
      {
        heading: "Grievance Redressal",
        body: "Employees may report grievances, misconduct, or policy violations directly to the HR Department or designated officer. The Company shall ensure fair and confidential handling of grievances. Retaliation against good-faith reporting is strictly prohibited.",
      },
    ],
    acknowledgment:
      "I, {{name}}, hereby acknowledge that I have read, understood, and agree to abide by the Code of Conduct of Unicodez Softcorp Pvt. Ltd.",
  },
  nda: {
    title: "Non-Disclosure Agreement",
    preamble:
      'This Non-Disclosure Agreement ("Agreement") is made and entered into between Unicodez Softcorp Pvt. Ltd., a company incorporated under the Companies Act, 2013, having its registered office at 6th Floor, Regal Treasure, Ayodhya Bypass Road, Bhopal MP (the "Company"), AND {{name}} (the "Employee"). The Parties agree to the terms set forth below.',
    sections: [
      {
        heading: "Purpose",
        body: 'The Employee acknowledges that during the course of employment with the Company, the Employee will have access to confidential information, trade secrets, intellectual property, client data, and other proprietary information belonging to the Company or its clients ("Confidential Information"). The Employee agrees to maintain strict confidentiality and prevent unauthorized use or disclosure of such information.',
      },
      {
        heading: "Confidential Information",
        body: '"Confidential Information" shall include but not be limited to: client lists, contracts, proposals, and communications; source code, software, technical documentation, and project deliverables; business strategies, marketing plans, pricing policies, and financial data; personal information of employees, clients, or vendors.',
      },
      {
        heading: "Obligations of the Employee",
        body: "The Employee agrees: to hold all Confidential Information in strict confidence and not disclose it to any third party without prior written consent of the Company; not to use Confidential Information for any purpose other than performance of employment duties; to return all documents, devices, or materials containing Confidential Information upon termination of employment; not to copy, modify, or share Company or client data using unauthorized devices, email, or cloud services.",
      },
      {
        heading: "Exclusions",
        body: "Confidential Information shall not include information that is or becomes publicly available without breach of this Agreement; is lawfully obtained by the Employee from an independent third party; or is independently developed by the Employee without reference to the Company's information.",
      },
      {
        heading: "Term",
        body: "This Agreement shall remain in effect during the Employee's employment and shall survive for a period of six (6) years after termination of employment, irrespective of the cause of termination.",
      },
      {
        heading: "Remedies",
        body: "Any breach of this Agreement may cause irreparable harm to the Company. The Company shall be entitled to seek injunctive relief, damages, or any other remedies available under applicable law.",
      },
      {
        heading: "Governing Law and Jurisdiction",
        body: "This Agreement shall be governed by and construed in accordance with the laws of India. The courts of Madhya Pradesh shall have exclusive jurisdiction to adjudicate any disputes arising under this Agreement.",
      },
    ],
    acknowledgment:
      "IN WITNESS WHEREOF, I, {{name}}, have executed this Non-Disclosure Agreement.",
  },
  "leave-policy": {
    title: "Leave and Attendance Policy",
    preamble:
      "We are sharing the updated Attendance and Leave Policy to ensure clarity and adherence to our guidelines. Please review the following information carefully.",
    sections: [
      {
        heading: "Leave Allocation",
        body: 'Casual Leave: Each employee is allocated "01" Casual Leave per month. Casual Leave cannot be carried forward to the following year — we encourage employees to utilise their Casual Leave as required.\nMedical Leave: Employees are allotted a total of "12" Medical Leaves per year, granted upon submission of genuine medical certificates. Like Casual Leave, Medical Leave cannot be carried forward to the next year.',
      },
      {
        heading: "Leave Request Notification",
        body: "All leave requests must be submitted via email to info@unicodez.com and hr@unicodez.com, AND notified to the respective teams via MS Teams. Both actions are mandatory for leave approval.",
      },
      {
        heading: "Attendance Marking",
        body: 'To record attendance, all employees are required to use the biometric system upon arrival and send a "good morning" message in the MS Teams group.',
      },
      {
        heading: "Consequences of Unauthorized Leave",
        body: "Any leave taken without prior approval will result in salary deductions.",
      },
      {
        heading: "Office Assets and Device Policy",
        body: "Employees are prohibited from taking office assets and equipment outside the premises without prior approval from management. Unauthorized actions will result in strict disciplinary measures. Written approval is required to take company-issued devices home. Ensure security and data protection of company assets and data. Use company assets primarily for work-related tasks.",
      },
      {
        heading: "Late Coming Policy",
        body: "Office timings: 6:30 PM IST to 3:30 AM IST, Monday to Friday (March to November). Lunch hours: 10:00 PM IST to 10:45 PM IST.\nOffice timings: 7:30 PM IST to 4:30 AM IST, Monday to Friday (November to March). Lunch hours: 10:30 PM IST to 11:15 PM IST.",
      },
      {
        heading: "Set Off Against Leave for Late Coming",
        body: "Employees arriving after 6:30 PM IST will be considered late. Two late comings result in a warning; the third late coming will be treated as leave. For the third late coming, half-day leave will be deducted (0.5 earned leave per late coming). If no leave balance, deductions will be made from monthly salary.",
      },
    ],
    acknowledgment:
      "I, {{name}}, acknowledge that I have read, understood, and agree to abide by the Leave and Attendance Policy.",
  },
};
