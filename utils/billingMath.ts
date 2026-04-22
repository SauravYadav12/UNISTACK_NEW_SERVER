/**
 * Pure billing math. No Mongoose, no IO — every helper is trivially unit-testable.
 *
 * All amounts are stored as JS numbers. To avoid floating-point drift showing up
 * on invoice PDFs, every rounded operation goes through {@link roundMoney}, which
 * quantizes to 2 decimal places using banker's-rounding-free `Math.round` of the
 * scaled cents (same technique the salary module uses for per-day rates).
 */

export interface InvoiceLineItemInput {
  description: string;
  hours?: number;
  rate?: number;
  amount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** Quantize to 2 decimal places. NaN / ±Infinity collapse to 0 — never leak. */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Given a `rate` (per hour) and `hours`, return the line amount, rounded.
 * Negative hours / negative rates are treated as 0 — an invoice with negative
 * amounts is almost always a bug, not a credit note (credit notes are deferred).
 */
export function lineAmount(hours: number, rate: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0;
  if (hours <= 0 || rate <= 0) return 0;
  return roundMoney(hours * rate);
}

/** Sum of all line-item amounts, quantized. */
export function sumLineItems(lineItems: InvoiceLineItemInput[]): number {
  let sum = 0;
  for (const li of lineItems) {
    sum += Number.isFinite(li.amount) ? li.amount : 0;
  }
  return roundMoney(sum);
}

/**
 * Re-derive subtotal / taxAmount / total from the line items + tax percent so
 * the caller can't persist an arithmetically-inconsistent invoice.
 * taxPercent is accepted as the raw percent (e.g. 18 for 18 %), not a ratio.
 */
export function rebuildTotals(
  lineItems: InvoiceLineItemInput[],
  taxPercent: number
): InvoiceTotals {
  const subtotal = sumLineItems(lineItems);
  const pct = Number.isFinite(taxPercent) && taxPercent >= 0 ? taxPercent : 0;
  const taxAmount = roundMoney((subtotal * pct) / 100);
  const total = roundMoney(subtotal + taxAmount);
  return { subtotal, taxAmount, total };
}

/**
 * Compute the invoice due date given an ISO issue date and a payment-terms
 * day count. Always returns YYYY-MM-DD (UTC-stable — day math, not time math).
 */
export function computeDueDate(issueDateIso: string, termDays: number): string {
  if (!issueDateIso) throw new Error("issueDateIso is required");
  if (!Number.isFinite(termDays) || termDays < 0) {
    throw new Error("termDays must be a non-negative number");
  }
  const base = new Date(issueDateIso);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid issueDateIso");
  // Build a pure-UTC date so DST / local-TZ shifts never steal a day.
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + Math.floor(termDays));
  return d.toISOString().slice(0, 10);
}

/** Day-count difference (todayUTC - dueDateUTC). Negative → not overdue yet. */
export function daysOverdue(dueDate: string, nowIso: string = new Date().toISOString()): number {
  const due = new Date(dueDate);
  const now = new Date(nowIso);
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) return 0;
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowUtc - dueUtc) / (1000 * 60 * 60 * 24));
}
