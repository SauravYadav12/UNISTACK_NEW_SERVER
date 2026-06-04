/**
 * Friendly display names that appear in the `From:` header of every
 * outgoing email, by category.
 *
 * This is intentionally a CODE constant (not an env variable) so the
 * team can change a label by editing one line + redeploying the
 * server — no env-var update on every host (local dev, staging,
 * production droplet) and no risk of one environment drifting from
 * another. Address parts still come from env (SMTP_USER / HR_EMAIL_FROM
 * / COMPANY_EMAIL) because real mailboxes change per deployment.
 *
 * To add a new sender category:
 *   1. Add a new entry to MAIL_SENDER_NAMES below.
 *   2. Wire a matching entry in utils/mailSenders.ts.
 *   3. Use mailSenders.<category>.from / .replyTo at the sendMail call site.
 *
 * To rebrand an existing category:
 *   - Edit the value here, redeploy. That's it.
 */

export const MAIL_SENDER_NAMES = {
  /** Onboarding lifecycle: invite, info-request, BG check, offer
   *  letter, offer-accepted welcome, rejection. */
  ONBOARDING: "HR Unicodez",
  /** Holiday announcement emails fired by the daily holiday cron. */
  HOLIDAY: "HR Unicodez",
  /** Leave request notification + leave status (approval/rejection)
   *  emails to the requester. */
  LEAVE: "HR Unicodez",
  /** Login / password-reset one-time passwords. */
  OTP: "Info Unicodez",
  /** Invoice / billing emails from the invoiceEmailService cron. */
  INVOICE: "Unicodez Billing",
} as const;

export type MailSenderName =
  (typeof MAIL_SENDER_NAMES)[keyof typeof MAIL_SENDER_NAMES];
