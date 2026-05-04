import { getGenericNoticeTemplate } from "../templates";
import { mailTransporter } from "../utils/mailTransporter";
import { substitute } from "../utils/templateSubstitute";
import {
  getInvoiceEmailSettings,
  InvoiceEmailSettingsDoc,
} from "../models/invoiceEmailSettingsModel";
import { InvoiceDoc } from "../models/invoiceModel";
import { ProjectDoc } from "../models/projectModel";
import { TimesheetApprovalDoc } from "../models/timesheetApprovalModel";
import { TimesheetModel } from "../models/timesheetModel";
import { IEmailTemplateBlock } from "../interface/modelInterfaces";
import { daysOverdue } from "../utils/billingMath";
import ENV_VARS from "../config/env.config";

/** Resolve the "from" address. Prefer COMPANY_EMAIL, fall back to SMTP_USER. */
function fromAddress(): string {
  return (
    ENV_VARS.COMPANY_EMAIL ||
    ENV_VARS.SMTP_USER ||
    "no-reply@unicodez.local"
  );
}

function substBlock(
  block: IEmailTemplateBlock,
  vars: Record<string, unknown>
): IEmailTemplateBlock {
  return {
    subject: substitute(block.subject, vars),
    heading: substitute(block.heading, vars),
    bodyLead: substitute(block.bodyLead, vars),
    bodyDetails: substitute(block.bodyDetails, vars),
    signOff: substitute(block.signOff, vars),
  };
}

/** Collect recipient emails for a raised invoice from the project flags. */
export function collectInvoiceRecipients(project: ProjectDoc, override?: string[]): string[] {
  if (override && override.length) {
    return override.filter((e) => !!e && e.includes("@"));
  }
  const flags = project.invoiceRecipients || {
    client: true,
    vendor: false,
    primeVendor: false,
    customEmails: [],
  };
  const out: string[] = [];
  if (flags.client && project.clientEmail) out.push(project.clientEmail);
  if (flags.vendor && project.vendorEmail) out.push(project.vendorEmail);
  if (flags.primeVendor && project.primeVendorEmail)
    out.push(project.primeVendorEmail);
  for (const e of flags.customEmails || []) {
    if (e && e.includes("@")) out.push(e);
  }
  // Dedup
  return [...new Set(out)];
}

export async function sendInvoiceRaisedEmail(opts: {
  invoice: InvoiceDoc;
  project: ProjectDoc;
  to: string[];
  cc?: string[];
  /** Optional client-edited subject; overrides the template. */
  subject?: string;
  /** Optional client-edited body; when set we skip the templated layout and
   *  send this verbatim (wrapped in the brand shell) so admins keep full
   *  control over what goes out. */
  body?: string;
}): Promise<void> {
  const settings: InvoiceEmailSettingsDoc = await getInvoiceEmailSettings();
  const vars: Record<string, unknown> = {
    invoiceNumber: opts.invoice.invoiceNumber,
    projectId: opts.invoice.projectId,
    organizationName: opts.invoice.organizationName,
    clientCompany: opts.project.clientCompany || "",
    vendorCompany: opts.project.vendorCompany || "",
    primeVendorCompany: opts.project.primeVendorCompany || "",
    issueDate: opts.invoice.issueDate || "",
    dueDate: opts.invoice.dueDate || "",
    total: opts.invoice.total.toFixed(2),
    currency: opts.invoice.currency,
    periodMonth: opts.invoice.periodMonth,
  };
  const block = substBlock(settings.raised, vars);

  const finalSubject = opts.subject?.trim() || block.subject;
  const html = await getGenericNoticeTemplate({
    subject: finalSubject,
    heading: block.heading,
    // If the admin typed a body in the email dialog, we honour it as the lead
    // copy. Otherwise fall back to the templated bodyLead + details stack.
    bodyLead: opts.body?.trim() || block.bodyLead,
    bodyDetails: opts.body?.trim() ? "" : block.bodyDetails,
    signOff: block.signOff,
    tag: `INVOICE ${opts.invoice.invoiceNumber}`,
  });

  // Pull any approved-timesheet screenshots stored on the monthly timesheet
  // so they ride along with the invoice email. Vendors / clients expect the
  // proof-of-work alongside the PDF.
  let screenshotAttachments: Array<{ filename: string; path: string }> = [];
  try {
    const sheet = await TimesheetModel.findOne({
      projectRef: opts.invoice.projectRef,
      periodMonth: opts.invoice.periodMonth,
    }).lean();
    screenshotAttachments = (sheet?.screenshots || []).map((s, i) => ({
      filename:
        s.fileName ||
        `timesheet-${opts.invoice.periodMonth}-week${i + 1}.png`,
      path: s.url,
    }));
  } catch (e) {
    console.warn(
      "[invoice] screenshot attach lookup failed:",
      (e as Error).message
    );
  }

  const pdfAttachment = opts.invoice.pdfUrl
    ? [
        {
          filename: `${opts.invoice.invoiceNumber}.pdf`,
          path: opts.invoice.pdfUrl,
        },
      ]
    : [];

  // Capture the SMTP response so we can tell — when a recipient (typically
  // a Gmail address) "doesn't get the email" — whether it was:
  //   (a) rejected at SMTP time → it lands in `info.rejected`, indicating
  //       a code/relay issue we need to address;
  //   (b) accepted by the SMTP server → it lands in `info.accepted` and
  //       the message left our system; any later non-delivery is a
  //       deliverability problem (SPF/DKIM/DMARC, spam folder, recipient
  //       block) on the receiving side, NOT a bug here.
  // Without this log we'd be guessing; with it the cause is unambiguous.
  const info = await mailTransporter.sendMail({
    from: fromAddress(),
    // `replyTo` makes replies route back to the company inbox even when
    // the auth-user (envelope) is a different relay account. Also a small
    // positive signal in Gmail's spam scoring.
    replyTo: fromAddress(),
    to: opts.to.join(", "),
    cc: (opts.cc || []).length ? (opts.cc || []).join(", ") : undefined,
    subject: finalSubject,
    html,
    // nodemailer fetches HTTP(S) URLs directly as attachments. S3 URLs are
    // public, so no presign dance needed.
    attachments:
      pdfAttachment.length + screenshotAttachments.length > 0
        ? [...pdfAttachment, ...screenshotAttachments]
        : undefined,
  });

  console.log(
    `[invoice-email] ${opts.invoice.invoiceNumber} sent`,
    {
      messageId: info?.messageId,
      accepted: info?.accepted,
      rejected: info?.rejected,
      response: info?.response,
    }
  );
}

export async function sendInvoiceDueEmail(opts: {
  invoice: InvoiceDoc;
  project: ProjectDoc;
}): Promise<void> {
  const settings = await getInvoiceEmailSettings();
  const overdue =
    opts.invoice.dueDate != null ? Math.max(0, daysOverdue(opts.invoice.dueDate)) : 0;
  const vars: Record<string, unknown> = {
    invoiceNumber: opts.invoice.invoiceNumber,
    projectId: opts.invoice.projectId,
    organizationName: opts.invoice.organizationName,
    clientCompany: opts.project.clientCompany || "",
    vendorCompany: opts.project.vendorCompany || "",
    primeVendorCompany: opts.project.primeVendorCompany || "",
    issueDate: opts.invoice.issueDate || "",
    dueDate: opts.invoice.dueDate || "",
    total: opts.invoice.total.toFixed(2),
    currency: opts.invoice.currency,
    periodMonth: opts.invoice.periodMonth,
    daysOverdue: overdue,
  };

  const recipients = (ENV_VARS.ACCOUNTS_NOTIFY_EMAILS || []).filter(Boolean);
  if (!recipients.length) {
    console.warn(
      `[invoice-due] ACCOUNTS_NOTIFY_EMAILS is empty; skipping alert for ${opts.invoice.invoiceNumber}`
    );
    return;
  }

  const block = substBlock(settings.due, vars);
  const html = await getGenericNoticeTemplate({
    subject: block.subject,
    heading: block.heading,
    bodyLead: block.bodyLead,
    bodyDetails: block.bodyDetails,
    signOff: block.signOff,
    tag: `OVERDUE · ${overdue}d`,
    tagBg: "#EF4444",
  });

  await mailTransporter.sendMail({
    from: fromAddress(),
    to: recipients.join(", "),
    subject: block.subject,
    html,
  });
}

/** Sends the timesheet-approval request to all super-admins. */
export async function sendTimesheetApprovalEmail(opts: {
  approval: TimesheetApprovalDoc;
  project: ProjectDoc;
  superAdminEmails: string[];
  requestedByLabel: string;
}): Promise<void> {
  if (!opts.superAdminEmails.length) return;
  const settings = await getInvoiceEmailSettings();
  const vars: Record<string, unknown> = {
    invoiceNumber: "(not yet)",
    projectId: opts.approval.projectId,
    organizationName: opts.project.organizationName || "",
    clientCompany: opts.project.clientCompany || "",
    vendorCompany: opts.project.vendorCompany || "",
    primeVendorCompany: opts.project.primeVendorCompany || "",
    periodMonth: opts.approval.periodMonth,
    totalHours: opts.approval.totalHoursAtSubmission ?? 0,
    requestedBy: opts.requestedByLabel,
    issueDate: "",
    dueDate: "",
    total: "",
    currency: "",
  };
  // Deep-link back into the admin app at the right project + Timesheets tab
  // and the right period month. Projects.tsx reads these query params and
  // opens the drawer automatically.
  const base = ENV_VARS.FRONTEND_URL?.replace(/\/+$/, "") || "";
  const ctaUrl = base
    ? `${base}/projects?project=${String(opts.approval.projectRef)}&tab=timesheets&period=${encodeURIComponent(opts.approval.periodMonth)}`
    : undefined;

  const block = substBlock(settings.timesheetApprovalRequest, vars);
  const html = await getGenericNoticeTemplate({
    subject: block.subject,
    heading: block.heading,
    bodyLead: block.bodyLead,
    bodyDetails: block.bodyDetails,
    signOff: block.signOff,
    tag: "APPROVAL REQUEST",
    tagBg: "#37B7EA",
    ctaLabel: ctaUrl ? "Review timesheet" : undefined,
    ctaUrl,
  });
  await mailTransporter.sendMail({
    from: fromAddress(),
    to: opts.superAdminEmails.join(", "),
    subject: block.subject,
    html,
  });
}
