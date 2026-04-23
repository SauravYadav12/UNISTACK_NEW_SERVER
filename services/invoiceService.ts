import mongoose from "mongoose";
import { TimesheetModel } from "../models/timesheetModel";
import { ProjectModel, ProjectDoc } from "../models/projectModel";
import { InvoiceModel, InvoiceDoc } from "../models/invoiceModel";
import { TimesheetApprovalDoc } from "../models/timesheetApprovalModel";
import { monthlySequenceId } from "../utils/monthlySequenceId";
import { lineAmount, rebuildTotals } from "../utils/billingMath";
import { IInvoiceLineItem } from "../interface/modelInterfaces";

// Extract the hourly rate from a project's frozen rate snapshot.
//
// Supported input shapes (in order of priority):
//   1. Object: `{ value: number, currency: string }`  — structured path.
//   2. String: "$55/hr", "$90", "₹1000/hr", "USD 55", "55", "5,500.50", etc.
//      The parser strips commas, pulls the first numeric run, and sniffs
//      the currency from common symbols (`$€£¥₹`) or a 3-letter ISO code.
//
// The previous implementation treated strings as `Number(r)` which returns
// NaN for anything with a currency symbol or unit suffix — so a perfectly
// valid rate like "$55/hr" on the requirement would flow into the invoice
// as 0, producing zero-total drafts. The fix parses the numeric payload.
function extractRate(
  project: ProjectDoc,
): { value: number; currency: string } {
  const arr = (project.rate as unknown[]) || [];
  if (!Array.isArray(arr) || arr.length === 0) return { value: 0, currency: "USD" };
  const r = arr[0];

  // Structured shape: `{ value, currency }`.
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const obj = r as { value?: unknown; currency?: unknown };
    const value = Number(obj.value ?? 0);
    const currency =
      (typeof obj.currency === "string" && obj.currency) || "USD";
    return { value: Number.isFinite(value) ? value : 0, currency };
  }

  // String shape — the common case in practice.
  if (typeof r === "string") {
    // Strip grouping commas ("5,500" → "5500") then grab the first number.
    const cleaned = r.replace(/,/g, "");
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    const value = match ? Number(match[0]) : 0;

    // Currency heuristic: symbol first (most common), ISO code as fallback.
    let currency = "USD";
    if (r.includes("€")) currency = "EUR";
    else if (r.includes("£")) currency = "GBP";
    else if (r.includes("¥")) currency = "JPY";
    else if (r.includes("₹")) currency = "INR";
    else if (r.includes("$")) currency = "USD";
    else {
      const iso = r.match(/\b([A-Z]{3})\b/);
      if (iso) currency = iso[1];
    }

    return { value: Number.isFinite(value) ? value : 0, currency };
  }

  return { value: 0, currency: "USD" };
}

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatPeriodLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES_LONG[idx] ?? m} ${y}`;
}

/** English ordinal suffix: 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, etc. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "1st Mar" — the canonical day-label used in invoice descriptions. */
function formatDayMonth(dateStr: string): string {
  // dateStr is YYYY-MM-DD in UTC — no timezone drift needed.
  const [, monthStr, dayStr] = dateStr.split("-");
  const mi = Number(monthStr) - 1;
  return `${ordinal(Number(dayStr))} ${MONTH_NAMES_SHORT[mi] ?? monthStr}`;
}

interface WeekChunk {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  hours: number;
}

/**
 * Split a monthly timesheet into 7-day chunks starting from day 1, matching
 * the invoice sample's "1-7, 8-14, 15-21, 22-28, 29-end" layout. Final chunk
 * is partial when the month has more than 28 days.
 */
function chunkMonthlyTimesheet(
  periodMonth: string,
  entries: Array<{ date: string; hours: number }>
): WeekChunk[] {
  const byDate = new Map(entries.map((e) => [e.date, e.hours]));
  const [year, month] = periodMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const chunks: WeekChunk[] = [];

  for (let startDay = 1; startDay <= lastDay; startDay += 7) {
    const endDay = Math.min(startDay + 6, lastDay);
    let hours = 0;
    for (let d = startDay; d <= endDay; d++) {
      const key = `${periodMonth}-${String(d).padStart(2, "0")}`;
      hours += byDate.get(key) || 0;
    }
    chunks.push({
      startDate: `${periodMonth}-${String(startDay).padStart(2, "0")}`,
      endDate: `${periodMonth}-${String(endDay).padStart(2, "0")}`,
      hours,
    });
  }
  return chunks;
}

/**
 * Given an approved TimesheetApproval, build + persist a Draft invoice.
 * Line items: one per saved week in that month, hours × rate.
 * Returns the newly-created InvoiceDoc. Pure failure cases throw; callers
 * should return 4xx to the UI so the admin can fix the project and retry.
 */
/**
 * Direct Draft generator used by the admin override flow. Builds an approval
 * record + invoice in one shot, skipping the submit/approve exchange. Same
 * billing math as the standard path.
 */
export async function buildDraftOverride(args: {
  projectId: string;
  periodMonth: string;
  createdByUser?: mongoose.Types.ObjectId;
}): Promise<InvoiceDoc> {
  const project = await ProjectModel.findById(args.projectId);
  if (!project) throw new Error("Project not found");
  if (!project.organizationRef) {
    throw new Error("Project has no organization — assign one first");
  }

  // Upsert a TimesheetApproval so the invoice's approvalRef has something to
  // point at. Status is Approved (to reflect admin fiat).
  const TimesheetApproval = (await import("../models/timesheetApprovalModel"))
    .TimesheetApprovalModel;
  const approval = await TimesheetApproval.findOneAndUpdate(
    { projectRef: project._id, periodMonth: args.periodMonth },
    {
      $set: {
        projectRef: project._id,
        projectId: project.projectId,
        organizationRef: project.organizationRef,
        periodMonth: args.periodMonth,
        status: "Approved",
        approvedAt: new Date(),
        approvedBy: args.createdByUser,
        requestedAt: new Date(),
        requestedBy: args.createdByUser,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const invoice = await buildDraftFromApproval(approval);
  approval.generatedInvoiceRef = invoice._id;
  await approval.save();
  return invoice;
}

export async function buildDraftFromApproval(
  approval: TimesheetApprovalDoc
): Promise<InvoiceDoc> {
  const project = await ProjectModel.findById(approval.projectRef);
  if (!project) throw new Error("Project not found for approval");

  const rate = extractRate(project);
  const taxPercent = project.taxPercent ?? 0;

  const sheet = await TimesheetModel.findOne({
    projectRef: project._id,
    periodMonth: approval.periodMonth,
  }).lean();

  // Weekly line items — one per 7-day chunk of the month (Day 1-7, 8-14,
  // 15-21, 22-28, 29-end). Matches the organization's paper invoice layout
  // so admins get a line they can cross-reference against timesheets.
  const [, monthStr] = approval.periodMonth.split("-");
  const year = approval.periodMonth.split("-")[0];
  const chunks = chunkMonthlyTimesheet(
    approval.periodMonth,
    (sheet?.entries || []) as Array<{ date: string; hours: number }>
  );
  const serviceLabel = project.jobTitle || "Services";
  const lineItems: IInvoiceLineItem[] = chunks
    .filter((c) => c.hours > 0)
    .map((c) => ({
      description: `${serviceLabel} WE ${formatDayMonth(c.startDate)} to ${formatDayMonth(c.endDate)} ${year}`,
      hours: c.hours,
      rate: rate.value,
      amount: lineAmount(c.hours, rate.value),
    }));
  // monthStr is referenced by formatPeriodLabel via approval.periodMonth; retain
  // the destructure so future tweaks have it handy.
  void monthStr;

  const totals = rebuildTotals(lineItems, taxPercent);

  const shortCode = project.organizationShortCode || "ORG";
  const periodKey = approval.periodMonth.replace("-", ""); // YYYYMM
  const invoiceNumber = await monthlySequenceId({
    scope: "invoice",
    key: `${shortCode}-${periodKey}`,
    prefix: "INV",
  });

  const invoice = await InvoiceModel.create({
    invoiceNumber,
    projectRef: project._id,
    projectId: project.projectId,
    organizationRef: approval.organizationRef,
    organizationName: project.organizationName || "",
    periodMonth: approval.periodMonth,

    lineItems,
    subtotal: totals.subtotal,
    taxLabel: project.taxPercent ? "Tax" : undefined,
    taxPercent,
    taxAmount: totals.taxAmount,
    total: totals.total,
    currency: rate.currency,

    status: "Draft",
    approvalRef: approval._id as mongoose.Types.ObjectId,

    notes: `Auto-generated for ${formatPeriodLabel(approval.periodMonth)}.`,
  });

  return invoice;
}
