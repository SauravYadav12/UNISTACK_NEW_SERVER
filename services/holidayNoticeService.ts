import moment from "moment-timezone";
import { HolidayModel } from "../models/holidayModel";
import { UserModel } from "../models/userModel";
import { UserShift } from "../interface/constants";
import {
  getHolidayNoticeSettings,
  HolidayNoticeSettingsDoc,
} from "../models/holidayNoticeSettingsModel";
import { getHolidayNoticeTemplate } from "../templates";
import { HolidayNoticeVariables } from "../templates/email/HolidayNotice";
import { sendMail } from "../utils/mailTransporter";
import ENV_VARS from "../config/env.config";

const COMPANY_NAME = "Unicodez Softcorp Private Limited";
const TZ = "America/New_York";

function prettyDate(iso: string): string {
  // Stored as YYYY/MM/DD — format as "Monday, 26 January 2026".
  return moment(iso, "YYYY/MM/DD").format("dddd, D MMMM YYYY");
}

function countryLabel(c: string | undefined): string {
  if (c === "IN") return "India";
  if (c === "US") return "United States";
  return "All offices";
}

// Substitute {{var}} tokens with the given variable map. Unknown tokens
// are left as-is so the admin can see "{{wrongName}}" on the preview and fix.
function substitute(template: string, vars: Record<string, string | number>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) => {
    const v = vars[key];
    return v == null ? match : String(v);
  });
}

interface BuildContext {
  employeeName: string;
  holidayName: string;
  holidayDate: string;
  daysUntil: number;
  country: string;
  companyName: string;
}

function buildVars(
  settings: HolidayNoticeSettingsDoc | { subject: string; heading: string; bodyLead: string; bodyDetails: string; signOff: string },
  ctx: BuildContext,
): HolidayNoticeVariables {
  const dict: Record<string, string | number> = { ...ctx };
  return {
    ...ctx,
    subject: substitute(settings.subject, dict),
    heading: substitute(settings.heading, dict),
    bodyLead: substitute(settings.bodyLead, dict),
    bodyDetails: substitute(settings.bodyDetails, dict),
    signOff: substitute(settings.signOff, dict),
  };
}

/**
 * Render the email for a sample context (used by the settings preview).
 * Doesn't actually send — returns { subject, html }.
 */
export async function previewHolidayNotice(opts?: {
  employeeName?: string;
  holidayName?: string;
  holidayDate?: string;
  daysUntil?: number;
  country?: string;
}) {
  const settings = await getHolidayNoticeSettings();
  const ctx: BuildContext = {
    employeeName: opts?.employeeName || "Saurav",
    holidayName: opts?.holidayName || "Republic Day",
    holidayDate: opts?.holidayDate || prettyDate(moment().add(7, "days").format("YYYY/MM/DD")),
    daysUntil: opts?.daysUntil ?? 7,
    country: opts?.country || "India",
    companyName: COMPANY_NAME,
  };
  const vars = buildVars(settings, ctx);
  const html = await getHolidayNoticeTemplate(vars);
  return { subject: vars.subject, html, preview: vars };
}

interface RecipientRow {
  email: string;
  name: string;
}

async function recipientsForCountry(country: "IN" | "US" | "ALL"): Promise<RecipientRow[]> {
  const filter: Record<string, unknown> = { active: true };
  if (country === "IN") filter.shift = UserShift.India;
  else if (country === "US") filter.shift = UserShift.US;
  // "ALL" → no shift filter, email everyone active.
  const users = await UserModel.find(filter).select("firstName lastName email").lean();
  return users.map((u) => ({
    email: u.email,
    name: ((u.firstName || "") + " " + (u.lastName || "")).trim() || u.email,
  }));
}

/**
 * Find holidays whose fromDate == today + daysBefore and send the heads-up
 * email. Idempotent: marks noticeSentAt on success so subsequent runs skip.
 *
 * Returns a summary the scheduler can log and the API can return.
 */
export async function sendHolidayNoticesForToday() {
  const settings = await getHolidayNoticeSettings();
  if (!settings.enabled) {
    return { enabled: false, holidays: 0, emails: 0 };
  }

  const targetDate = moment
    .tz(TZ)
    .startOf("day")
    .add(settings.daysBefore, "days")
    .format("YYYY/MM/DD");

  const holidays = await HolidayModel.find({
    fromDate: targetDate,
    noticeSentAt: { $exists: false },
  });

  let totalEmails = 0;
  for (const h of holidays) {
    const country = (h.country || "ALL") as "IN" | "US" | "ALL";
    const recipients = await recipientsForCountry(country);
    if (!recipients.length) {
      // Still mark so we don't retry forever on an empty-list holiday.
      await HolidayModel.updateOne(
        { _id: h._id },
        { $set: { noticeSentAt: new Date(), noticeSentTo: 0 } },
      );
      continue;
    }

    const holidayDate = prettyDate(h.fromDate);
    const template = getHolidayNoticeTemplate as typeof getHolidayNoticeTemplate;

    let successCount = 0;
    for (const r of recipients) {
      const ctx: BuildContext = {
        employeeName: r.name,
        holidayName: h.name || "Public holiday",
        holidayDate,
        daysUntil: settings.daysBefore,
        country: countryLabel(country),
        companyName: COMPANY_NAME,
      };
      const vars = buildVars(settings, ctx);
      try {
        const html = await template(vars);
        await sendMail({
          from: ENV_VARS.COMPANY_EMAIL,
          to: r.email,
          subject: vars.subject,
          html,
        });
        successCount++;
      } catch (e) {
        console.error(
          `[holiday-notice] Failed to send to ${r.email} for ${h.name}:`,
          (e as Error).message,
        );
      }
    }

    await HolidayModel.updateOne(
      { _id: h._id },
      { $set: { noticeSentAt: new Date(), noticeSentTo: successCount } },
    );
    totalEmails += successCount;
  }

  return { enabled: true, holidays: holidays.length, emails: totalEmails };
}

export { buildVars, prettyDate, countryLabel, substitute };
