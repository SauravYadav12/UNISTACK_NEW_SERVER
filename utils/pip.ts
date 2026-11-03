/**
 * PIP (Performance Improvement Plan) shared constants + helpers.
 *
 * A PIP runs for an initial window (PIP_DAYS), extendable by
 * PIP_DEFAULT_EXTENSION_DAYS if the first review is unsatisfactory, after
 * which an unsatisfactory outcome leads to termination. The default email
 * body is generated here so the letter wording lives in ONE place (the
 * preview endpoint and any fallback both use it).
 */

export const PIP_DAYS = 30;
export const PIP_DEFAULT_EXTENSION_DAYS = 15;

export const PIP_REASONS = [
  "performance",
  "punctuality",
  "late-comings",
  "non-productive-45",
  "other",
] as const;
export type PipReason = (typeof PIP_REASONS)[number];

export const PIP_REASON_LABELS: Record<PipReason, string> = {
  performance: "Performance issues",
  punctuality: "Punctuality",
  "late-comings": "Too many late comings",
  "non-productive-45": "Non-productive for more than 45 days",
  other: "Other",
};

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function computePipEndDate(start: Date, days: number = PIP_DAYS): Date {
  return addDays(start, days);
}

/** Human-readable reason lines for the letter body. */
export function reasonLines(
  reasons: PipReason[],
  otherReason?: string
): string[] {
  return reasons.map((r) =>
    r === "other" && otherReason && otherReason.trim()
      ? otherReason.trim()
      : PIP_REASON_LABELS[r]
  );
}

export interface DefaultPipEmailInput {
  employeeName: string;
  reasons: PipReason[];
  otherReason?: string;
  durationDays?: number;
  extensionDays?: number;
}

/**
 * Build the default PIP initiation letter. Deliberately date-agnostic
 * ("from the date of this notice") because the draft is written before the
 * send date is known — the concrete PIP start/end are tracked in the system
 * and shown on the card, not baked into the letter text.
 */
export function buildDefaultPipEmail(input: DefaultPipEmailInput): {
  subject: string;
  body: string;
} {
  const {
    employeeName,
    reasons,
    otherReason,
    durationDays = PIP_DAYS,
    extensionDays = PIP_DEFAULT_EXTENSION_DAYS,
  } = input;
  const name = employeeName || "Employee";
  const lines = reasonLines(reasons, otherReason);
  const bullets = lines.map((l) => `  • ${l}`).join("\n");

  const subject = `Performance Improvement Plan (PIP) – ${name}`;
  const body = [
    `Dear ${name},`,
    ``,
    `This letter is to formally notify you that you are being placed on a Performance Improvement Plan (PIP), effective from the date of this notice.`,
    ``,
    `This decision has been made on account of the following concern(s):`,
    bullets,
    ``,
    `The purpose of this PIP is to give you a clear and fair opportunity to address and improve in the area(s) noted above. The plan will run for an initial period of ${durationDays} days, at the end of which your performance will be reviewed.`,
    ``,
    `If your performance at that review is found to be unsatisfactory, the plan may be extended by a further ${extensionDays} days. Should there be no satisfactory improvement after the extension period, it may lead to termination of your employment.`,
    ``,
    `We are committed to supporting you through this period. Please treat this plan with the seriousness it warrants, and feel free to reach out to your manager or the HR team for any clarification or support you may need.`,
    ``,
    `Regards,`,
    `HR Team`,
    `Unicodez Softcorp Private Limited`,
  ].join("\n");

  return { subject, body };
}

/**
 * Default body for the PIP-removed email — the employee has been taken off
 * the plan by a super-admin. This is NOT a termination (the account stays
 * active); the tone is a clean close-out, not a warning.
 */
export function buildPipRemovedEmail(input: {
  employeeName: string;
}): { subject: string; body: string } {
  const name = input.employeeName || "Employee";
  const subject = `Performance Improvement Plan – Update`;
  const body = [
    `Dear ${name},`,
    ``,
    `This letter is to inform you that you have been removed from the Performance Improvement Plan (PIP) that you were previously placed on. The plan is now closed and no further action is required from you in connection with it.`,
    ``,
    `We appreciate your efforts and encourage you to maintain consistent, positive performance going forward. If you have any questions, please feel free to reach out to the HR team.`,
    ``,
    `Regards,`,
    `HR Team`,
    `Unicodez Softcorp Private Limited`,
  ].join("\n");
  return { subject, body };
}

/** Default body for the PIP-failed / termination outcome email. */
export function buildPipFailedEmail(input: {
  employeeName: string;
}): { subject: string; body: string } {
  const name = input.employeeName || "Employee";
  const subject = `Performance Improvement Plan – Outcome`;
  const body = [
    `Dear ${name},`,
    ``,
    `This letter concerns the Performance Improvement Plan (PIP) that you were placed on. After completing the plan period (including any extension) and reviewing your performance, we regret to inform you that the required level of improvement was not met.`,
    ``,
    `Accordingly, your employment with Unicodez Softcorp Private Limited is being concluded and your access to company systems is being deactivated.`,
    ``,
    `The HR team will reach out separately regarding the formalities of your exit. If you have any questions, please contact HR.`,
    ``,
    `Regards,`,
    `HR Team`,
    `Unicodez Softcorp Private Limited`,
  ].join("\n");
  return { subject, body };
}
