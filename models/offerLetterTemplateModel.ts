/**
 * Offer letter template — the editable boilerplate the offer-letter
 * compose flow pulls in. Multiple docs can exist over time; exactly
 * ONE has `active: true` at any moment. Editing the template via
 * `PATCH /onboarding/template` clones the previous active row,
 * applies the change, marks the new row active and the previous one
 * inactive. The version history is therefore the collection itself
 * (no separate audit table).
 *
 * Critically, when an offer is SENT to a candidate, the controller
 * embeds the current active template's content directly onto the
 * candidate's `offer.templateAtSendTime` field. From that moment on,
 * rendering the offer letter uses that embedded snapshot, NOT the
 * latest active row — so subsequent template edits never alter
 * already-sent offers.
 *
 * Body / salutation / closing fields contain `{{placeholder}}` tokens
 * resolved by a tiny string-replace helper in the controller. The
 * supported variables are:
 *   {{firstName}}, {{lastName}}, {{name}}, {{position}}, {{startDate}},
 *   {{annualSalary}}, {{probationMonths}}, {{signatoryName}},
 *   {{signatoryTitle}}, {{companyName}}, {{companyAddress}},
 *   {{companyEmail}}, {{companyWebsite}}
 */

import mongoose, { Document, Schema, Types } from "mongoose";

export interface OfferLetterTemplateDoc extends Document {
  _id: Types.ObjectId;
  salutationTemplate: string;
  bodyTemplate: string;
  termsTemplate: string;
  closingTemplate: string;
  signatoryName: string;
  signatoryTitle: string;
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyWebsite: string;
  // Optional director's signature as a base64 PNG data URL. Auto-painted
  // above the signatory name on every rendered offer letter. Super-admin
  // uploads / replaces this via the template editor.
  directorSignatureDataUrl?: string;
  active: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const offerLetterTemplateSchema = new Schema<OfferLetterTemplateDoc>(
  {
    salutationTemplate: {
      type: String,
      required: true,
      default: "Dear {{firstName}},",
    },
    // Body intentionally stays high-level — the structured Employment
    // Details block (Position / Start Date / Annual Salary / Probation
    // Period) is rendered as a styled InfoRow grid further down the
    // letter by OfferLetterRender. Repeating it as plain text here was
    // duplicative.
    bodyTemplate: {
      type: String,
      required: true,
      default:
        "We are pleased to offer you the position of {{position}} at {{companyName}}. We believe that your skills and experience will be a valuable addition to our team, and we look forward to working with you.\n\nYour employment with us is subject to the conditions outlined in this letter and the company's policies as referenced in the Terms & Conditions section below.",
    },
    // Terms now absorbs Appraisal + Leave & Benefits (previously
    // floating in the body) so all rules-of-engagement live in one
    // block. Renderer auto-bolds the "Label:" prefixes.
    termsTemplate: {
      type: String,
      required: true,
      default:
        "Appraisal: Subject to your performance, your appraisal will be considered from the date of your confirmation and subject to market standards.\n\nLeave & Benefits: During the probation period, you will not be entitled to any leaves or additional benefits.\n\nYour employment will be subject to the company's policies and regulations. Upon successful completion of the probation period, your confirmation will be based on your performance and company requirements. The company reserves the right to terminate employment during the probation period with prior notice, as per company policy.\n\nThe probation period will be applicable as per company policy. In the event that the employee resigns or discontinues employment during the probation period, no salary, experience certificate, or relieving letter shall be released or issued.\n\nUpon successful completion of probation, the employees' services will be confirmed in writing. Post confirmation, the notice period will be 45 days, subject to management's discretion. The company reserves the right to relieve the employee earlier or adjust the notice period as deemed appropriate.",
    },
    closingTemplate: {
      type: String,
      required: true,
      default:
        "Please sign and return a copy of this letter as a token of your acceptance of the offer. If you have any questions, feel free to reach out.\n\nWe look forward to welcoming you to our team and wish you success in your role.",
    },
    signatoryName: {
      type: String,
      required: true,
      default: "Anmol Shrivastava",
    },
    signatoryTitle: {
      type: String,
      required: true,
      default: "Director",
    },
    companyName: {
      type: String,
      required: true,
      default: "Unicodez Softcorp Private Limited",
    },
    companyAddress: {
      type: String,
      required: true,
      default:
        "Hall 9/10, Floor 6th, Regal Treasure, Bhopal 462021",
    },
    companyEmail: {
      type: String,
      required: true,
      default: "info@unicodez.com",
    },
    companyWebsite: {
      type: String,
      required: true,
      default: "www.unicodez.com",
    },
    directorSignatureDataUrl: { type: String },
    active: { type: Boolean, default: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Fast lookup of the single active template row.
offerLetterTemplateSchema.index({ active: 1, updatedAt: -1 });

export const OfferLetterTemplateModel = mongoose.model<OfferLetterTemplateDoc>(
  "OfferLetterTemplate",
  offerLetterTemplateSchema,
);
