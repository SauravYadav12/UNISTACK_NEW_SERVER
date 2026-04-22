import { Schema, model, Document, Types } from "mongoose";

/**
 * Admin-editable template for automated holiday-notice emails. Singleton
 * doc (only one row ever). The scheduler reads this on each tick; admin
 * can edit via /leaves Settings tab.
 *
 * Supported placeholders (substituted per-recipient before sending):
 *  {{employeeName}}  full name of recipient (falls back to email)
 *  {{holidayName}}   e.g. "Republic Day"
 *  {{holidayDate}}   pretty e.g. "Monday, 26 January 2026"
 *  {{daysUntil}}     integer — how many days away
 *  {{country}}       "India" | "United States" | "All offices"
 *  {{companyName}}   "Unicodez Softcorp Private Limited"
 */
export interface HolidayNoticeSettingsDoc extends Document {
  _id: Types.ObjectId;
  enabled: boolean;
  daysBefore: number;
  subject: string;
  heading: string;
  bodyLead: string;
  bodyDetails: string;
  signOff: string;
  updatedAt: Date;
  updatedBy?: Types.ObjectId;
}

const DEFAULTS = {
  enabled: true,
  daysBefore: 7,
  subject: "Upcoming holiday: {{holidayName}} on {{holidayDate}}",
  heading: "A holiday is coming up",
  bodyLead:
    "Hi {{employeeName}}, this is a friendly heads-up from Unicodez. " +
    "{{holidayName}} falls on {{holidayDate}} — {{daysUntil}} day(s) away.",
  bodyDetails:
    "Our {{country}} office will be closed on this day. Please plan your " +
    "work and any pending hand-offs accordingly. If you need to work or " +
    "swap the day, please notify your manager in advance.",
  signOff: "Have a great day,\nThe Unicodez HR Team",
};

const schema = new Schema<HolidayNoticeSettingsDoc>(
  {
    enabled: { type: Boolean, default: DEFAULTS.enabled },
    daysBefore: { type: Number, default: DEFAULTS.daysBefore, min: 1, max: 30 },
    subject: { type: String, default: DEFAULTS.subject },
    heading: { type: String, default: DEFAULTS.heading },
    bodyLead: { type: String, default: DEFAULTS.bodyLead },
    bodyDetails: { type: String, default: DEFAULTS.bodyDetails },
    signOff: { type: String, default: DEFAULTS.signOff },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const HolidayNoticeSettingsModel = model<HolidayNoticeSettingsDoc>(
  "HolidayNoticeSettings",
  schema,
);

/** Get the singleton settings, creating with defaults on first read. */
export async function getHolidayNoticeSettings() {
  const existing = await HolidayNoticeSettingsModel.findOne().lean();
  if (existing) return existing;
  const created = await HolidayNoticeSettingsModel.create({});
  return created.toObject();
}

export { DEFAULTS as HOLIDAY_NOTICE_DEFAULTS };
