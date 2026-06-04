/**
 * Centralised email sender registry.
 *
 * Every outgoing email in the app picks its `from:` / `replyTo:` pair
 * from here, so changing a label or address is one edit instead of a
 * hunt across controllers.
 *
 * Two halves to a From: header:
 *   • address — the real mailbox (must be on a verified domain for
 *     Resend; must match SMTP auth for cPanel-style hosts). Comes
 *     from env (SMTP_USER / HR_EMAIL_FROM / COMPANY_EMAIL) because
 *     real mailboxes vary by deployment.
 *   • display name — the friendly label Gmail/Outlook shows in the
 *     inbox list. Comes from constants/mailSenderNames.ts so renaming
 *     a sender is a one-line code change + redeploy with no env
 *     mutation across local + cloud.
 *
 * Without the display name, mail clients fall back to rendering just
 * the local part — e.g. "hr@unicodez.com" → "hr" — which looks
 * unbranded.
 */

import ENV_VARS from "../config/env.config";
import { MAIL_SENDER_NAMES } from "../constants/mailSenderNames";

/** Build a single RFC-2822 From: header. */
function formatSender(name: string, address: string): string {
  const n = (name || "").trim();
  if (!address) return n;
  return n ? `"${n}" <${address}>` : address;
}

// ── Address fallbacks ───────────────────────────────────────────────
// HR-flavored mail (onboarding, holiday, leave) should ideally come
// from hr@unicodez.com so replies route to HR. Falls back through
// info@ → SMTP user if HR_EMAIL_FROM isn't set.
const HR_ADDRESS =
  ENV_VARS.HR_EMAIL_FROM ||
  ENV_VARS.COMPANY_EMAIL ||
  ENV_VARS.SMTP_USER ||
  "";

// Generic / system mail (OTP, invoices) comes from info@.
const INFO_ADDRESS =
  ENV_VARS.COMPANY_EMAIL ||
  ENV_VARS.SMTP_USER ||
  ENV_VARS.HR_EMAIL_FROM ||
  "";

export const mailSenders = {
  onboarding: {
    from: formatSender(MAIL_SENDER_NAMES.ONBOARDING, HR_ADDRESS),
    replyTo: HR_ADDRESS,
  },
  holiday: {
    from: formatSender(MAIL_SENDER_NAMES.HOLIDAY, HR_ADDRESS),
    replyTo: HR_ADDRESS,
  },
  leave: {
    from: formatSender(MAIL_SENDER_NAMES.LEAVE, HR_ADDRESS),
    replyTo: HR_ADDRESS,
  },
  otp: {
    from: formatSender(MAIL_SENDER_NAMES.OTP, INFO_ADDRESS),
    replyTo: INFO_ADDRESS,
  },
  invoice: {
    from: formatSender(MAIL_SENDER_NAMES.INVOICE, INFO_ADDRESS),
    replyTo: INFO_ADDRESS,
  },
} as const;

export type MailCategory = keyof typeof mailSenders;
