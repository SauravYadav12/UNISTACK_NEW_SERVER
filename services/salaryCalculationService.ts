import moment from "moment";
import { FilterQuery, Types } from "mongoose";
import { UserModel } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { SalaryConfigModel } from "../models/salaryConfigModel";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";
import { LeaveTypeModel } from "../models/leaveTypeModel";
import { LeaveModel, LeaveDoc, LeaveStatus, LeavePaymentCategory } from "../models/leaveModel";
import { HolidayModel, HolidayCountry } from "../models/holidayModel";
import { AttendanceModel, AttendanceStatus } from "../models/attendance";
import { UserShift } from "../interface/constants";
import { SalarySlipModel, type SalarySlipDoc } from "../models/salarySlipModel";

type SlipPayload = Omit<
  SalarySlipDoc,
  | "_id"
  | "createdAt"
  | "updatedAt"
  | "save"
  | "toObject"
  | "toJSON"
  | keyof import("mongoose").Document
>;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function countWeekends(year: number, month: number): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day === 0 || day === 6) count++;
  }
  return count;
}

// Count Sat/Sun days inside the (inclusive) [startM, endM] range. Used by
// the DOJ/relieving-date prorating path so a mid-month joiner doesn't
// get credited working days that pre-date their joining.
function countWeekendsInRange(
  startM: moment.Moment,
  endM: moment.Moment,
): number {
  let count = 0;
  const cursor = startM.clone();
  while (cursor.isSameOrBefore(endM, "day")) {
    const day = cursor.day();
    if (day === 0 || day === 6) count++;
    cursor.add(1, "day");
  }
  return count;
}

// Sentinel thrown by `computeSalarySlip` when the user wasn't on
// payroll during the requested month (joined later, or already
// relieved). Caught by `generateForUser` to delete any stale slip and
// classify the run as a skip rather than a failure.
export const PRE_DOJ_OR_POST_RELIEVING = "PRE_DOJ_OR_POST_RELIEVING";

function overlapDays(
  rangeStart: moment.Moment,
  rangeEnd: moment.Moment,
  itemStart: moment.Moment,
  itemEnd: moment.Moment,
): number {
  const start = moment.max(rangeStart, itemStart);
  const end = moment.min(rangeEnd, itemEnd);
  const diff = end.diff(start, "days") + 1;
  return diff > 0 ? diff : 0;
}

async function countHolidaysInRange(
  rangeStartStr: string,
  rangeEndStr: string,
  country: "IN" | "US",
): Promise<number> {
  const holidays = await HolidayModel.find({
    country: { $in: [country, HolidayCountry.ALL] },
    fromDate: { $lte: rangeEndStr },
    toDate: { $gte: rangeStartStr },
  }).lean();

  const rangeStart = moment(rangeStartStr, "YYYY/MM/DD");
  const rangeEnd = moment(rangeEndStr, "YYYY/MM/DD");
  let total = 0;

  for (const h of holidays) {
    const hStart = moment(h.fromDate, "YYYY/MM/DD");
    const hEnd = moment(h.toDate, "YYYY/MM/DD");
    let days = overlapDays(rangeStart, rangeEnd, hStart, hEnd);
    if (h.isHalfDay) days = days * 0.5;
    total += days;
  }
  return total;
}

interface LeaveAgg {
  paidUsed: number;
  medicalUsed: number;
  unpaidDays: number;
}

// Minimal projection of `LeaveTypeDoc` that aggregateLeaves needs to bucket
// each split item. Defined locally so callers can pass `.lean()` results
// directly without conjuring a full Mongoose Doc.
interface LeaveTypeForAgg {
  isUnpaidBucket?: boolean;
  paid?: boolean;
  code?: string;
  name?: string;
  /** Per-month allowance baked into the leave type. Null = uncapped
   *  (UL, ML without a cap). Used as a fallback when the per-user
   *  balance row doesn't override. */
  monthlyQuota?: number | null;
}

function isMedicalType(t: LeaveTypeForAgg | undefined): boolean {
  if (!t) return false;
  if (t.code === "ML") return true;
  return /medical/i.test(t.name || "");
}

async function aggregateLeaves(
  userRef: string,
  fromDate: string,
  toDate: string,
  typeById: Map<string, LeaveTypeForAgg>,
): Promise<LeaveAgg> {
  const leaveFilter: FilterQuery<LeaveDoc> = {
    userRef: new Types.ObjectId(userRef),
    status: LeaveStatus.Approved,
    startDate: { $lte: toDate },
    endDate: { $gte: fromDate },
  } as FilterQuery<LeaveDoc>;
  const leaves = await LeaveModel.find(leaveFilter).lean();

  const rangeStart = moment(fromDate, "YYYY/MM/DD");
  const rangeEnd = moment(toDate, "YYYY/MM/DD");
  const agg: LeaveAgg = { paidUsed: 0, medicalUsed: 0, unpaidDays: 0 };

  for (const l of leaves) {
    const lStart = moment(l.startDate, "YYYY/MM/DD");
    const lEnd = moment(l.endDate, "YYYY/MM/DD");
    const overlap = overlapDays(rangeStart, rangeEnd, lStart, lEnd);
    if (overlap <= 0) continue;
    const halfDayMultiplier = l.isHalfDay ? 0.5 : 1;

    // Prefer `splitBreakdown` when present — that's the per-bucket truth
    // produced by `computeLeaveSplit` at apply time and used by
    // `applyBalanceEffects` for balance accounting. The leave's whole-doc
    // `paymentCategory` is a single flag (Paid/Medical/Unpaid) that
    // *over-reports* unpaid days when a request was partially absorbed by
    // the regular bucket and partially overflowed to UL — e.g., 3 leaves
    // requested with balance=2 produced split [{PL, 2}, {UL, 1}] but the
    // category got stamped Unpaid for the whole leave. Reading the split
    // here makes the slip agree with the balance ledger.
    const splits = l.splitBreakdown;
    if (splits && splits.length > 0) {
      const totalLeaveDays = lEnd.diff(lStart, "days") + 1;
      // Multi-month leaves: scale the split proportionally to the slice
      // that falls inside the slip's period. The balance side already
      // posted the full split at approval; the slip just needs the share
      // attributable to this month.
      const ratio = totalLeaveDays > 0 ? overlap / totalLeaveDays : 1;
      for (const item of splits) {
        const t = typeById.get(String(item.leaveType));
        const days = (item.days || 0) * ratio * halfDayMultiplier;
        if (!t) {
          // Orphan type reference — bucket as paid (least-harm: matches
          // the legacy fallback when paymentCategory is missing).
          agg.paidUsed += days;
          continue;
        }
        if (t.isUnpaidBucket) agg.unpaidDays += days;
        else if (isMedicalType(t)) agg.medicalUsed += days;
        else agg.paidUsed += days;
      }
      continue;
    }

    // Legacy / unsplit leaves (pre-multi-bucket flow) — fall back to the
    // whole-leave paymentCategory. Same behaviour as before this change.
    const days = overlap * halfDayMultiplier;
    const cat = l.paymentCategory || LeavePaymentCategory.Paid;
    if (cat === LeavePaymentCategory.Paid) agg.paidUsed += days;
    else if (cat === LeavePaymentCategory.Medical) agg.medicalUsed += days;
    else agg.unpaidDays += days;
  }
  return agg;
}

export function numToIndianWords(num: number): string {
  const n = Math.round(num);
  if (n === 0) return "Zero";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  function under1000(x: number): string {
    let s = "";
    if (x >= 100) {
      s += ones[Math.floor(x / 100)] + " Hundred ";
      x %= 100;
    }
    if (x >= 20) {
      s += tens[Math.floor(x / 10)];
      if (x % 10) s += " " + ones[x % 10];
    } else if (x > 0) {
      s += ones[x];
    }
    return s.trim();
  }

  let x = n;
  const parts: string[] = [];
  const crore = Math.floor(x / 10000000); x %= 10000000;
  const lakh = Math.floor(x / 100000); x %= 100000;
  const thousand = Math.floor(x / 1000); x %= 1000;
  const rest = x;
  if (crore) parts.push(under1000(crore) + " Crore");
  if (lakh) parts.push(under1000(lakh) + " Lakh");
  if (thousand) parts.push(under1000(thousand) + " Thousand");
  if (rest) parts.push(under1000(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function computeSalarySlip(
  userId: string,
  year: number,
  month: number,
): Promise<SlipPayload> {
  const userObjId = new Types.ObjectId(userId);
  const [user, profile, config, balances, allTypes] = await Promise.all([
    UserModel.findById(userId).lean(),
    UserProfileModel.findOne({ user: userObjId } as FilterQuery<Record<string, unknown>>).lean(),
    SalaryConfigModel.findOne({ user: userObjId }).lean(),
    LeaveBalanceModel.find({ user: userObjId, year }).lean(),
    LeaveTypeModel.find({}).lean(),
  ]);

  if (!user) throw new Error("User not found");

  // Config-level country wins over the user's timezone/shift (which is the
  // work-shift concept, not residence). Fall back to shift, default IN.
  const configCountry = (config?.country as "IN" | "US" | undefined);
  const country: "IN" | "US" =
    configCountry ||
    (user.shift === UserShift.India ? "IN" : user.shift === UserShift.US ? "US" : "IN");
  const currency: "INR" | "USD" = country === "IN" ? "INR" : "USD";

  const totalDays = daysInMonth(year, month);
  const monthStart = moment({ year, month: month - 1, day: 1 }).format("YYYY/MM/DD");
  const monthEnd = moment({ year, month: month - 1, day: totalDays })
    .format("YYYY/MM/DD");
  const yearStart = moment({ year, month: 0, day: 1 }).format("YYYY/MM/DD");

  // ── Full-month vs effective slice ──
  // `workingDays` is the CONTRACTUAL month (e.g. 22 working days in
  // June) — it drives the per-day rate calculation and stays the same
  // regardless of when the employee joined. Then we compute a separate
  // `effectiveWorkingDays` for the actually-worked slice, clipped by:
  //   - DOJ (a mid-month joiner only earns from their start day)
  //   - relievingDate (someone who left mid-month only earns to that day)
  //   - `today` (mid-month generation for the current month — June 5
  //     generation only counts June 1–5; the rest of the month hasn't
  //     happened yet so it can't be "present" yet)
  //
  // `presentDays = effectiveWorkingDays - inRangeUnpaid` (leaves + absents).
  // `lopDays = workingDays - presentDays` — this is what the deduction
  // is based on, so out-of-range days (pre-DOJ, post-today, post-
  // relieving) naturally show up as LOP without us double-counting them
  // anywhere else.
  const weekendDays = countWeekends(year, month);
  const holidays = await countHolidaysInRange(monthStart, monthEnd, country);
  const workingDays = Math.max(totalDays - weekendDays - holidays, 0);

  const monthStartM = moment(monthStart, "YYYY/MM/DD");
  const monthEndM = moment(monthEnd, "YYYY/MM/DD");
  const dojM = profile?.dateOfJoining
    ? moment(profile.dateOfJoining).startOf("day")
    : null;
  const relievingM = profile?.relievingDate
    ? moment(profile.relievingDate).endOf("day")
    : null;
  const todayM = moment().endOf("day");

  const effStartM =
    dojM && dojM.isAfter(monthStartM) ? dojM : monthStartM.clone();
  // Clip the end by EITHER the relieving date OR today, whichever is
  // earlier. `today` only matters for the current month — for past
  // months `today > monthEnd` so it's a no-op.
  let effEndM = monthEndM.clone();
  if (relievingM && relievingM.isBefore(effEndM)) effEndM = relievingM.clone();
  if (todayM.isBefore(effEndM)) effEndM = todayM.clone();

  if (effStartM.isAfter(effEndM, "day")) {
    // Pre-DOJ, post-relieving, or future month entirely — no slip
    // should exist for this user/month. Sentinel caught by the
    // generator wrapper, which deletes any stale slip and reports
    // SKIPPED instead of FAILED.
    throw new Error(PRE_DOJ_OR_POST_RELIEVING);
  }

  const effStart = effStartM.format("YYYY/MM/DD");
  const effEnd = effEndM.format("YYYY/MM/DD");
  const effTotalDays = effEndM.diff(effStartM, "days") + 1;
  const effWeekends = countWeekendsInRange(effStartM, effEndM);
  const effHolidays = await countHolidaysInRange(effStart, effEnd, country);
  const effectiveWorkingDays = Math.max(
    effTotalDays - effWeekends - effHolidays,
    0,
  );

  // Build `typeById` here (instead of after aggregateLeaves) so it can be
  // threaded into both calls — aggregateLeaves now reads `splitBreakdown`
  // on each leave and resolves each split item's leaveType to bucket the
  // days as paid / medical / unpaid.
  const typeById = new Map(allTypes.map((t) => [String(t._id), t]));

  // Leave aggregation runs only over the EFFECTIVE slice — pre-DOJ /
  // post-relieving / post-today days can't have valid leaves for this
  // employee, and including them would either double-count out-of-range
  // LOP (which we add below) or attribute leaves to a period they
  // shouldn't apply to.
  const monthAgg = await aggregateLeaves(userId, effStart, effEnd, typeById);
  const ytdAgg = await aggregateLeaves(userId, yearStart, monthEnd, typeById);

  // ── Fold Absent attendance into unpaid days ──
  // Any day the employee was marked Absent in attendance but DIDN'T file
  // an approved leave covering that date should count as an unpaid day
  // (i.e. drive the LOP deduction). Days that ARE covered by a leave are
  // already handled by `aggregateLeaves` above — skipping them here
  // avoids double-counting. Both queries are scoped to the effective
  // slice so out-of-range absences/leaves don't fold in twice.
  const approvedLeavesThisMonth = await LeaveModel.find({
    userRef: userObjId,
    status: LeaveStatus.Approved,
    startDate: { $lte: effEnd },
    endDate: { $gte: effStart },
  } as FilterQuery<LeaveDoc>).lean();
  const leaveDates = new Set<string>();
  for (const l of approvedLeavesThisMonth) {
    const lStart = moment(l.startDate, "YYYY/MM/DD");
    const lEnd = moment(l.endDate, "YYYY/MM/DD");
    const cursor = moment.max(lStart, effStartM).clone();
    const limit = moment.min(lEnd, effEndM);
    while (cursor.isSameOrBefore(limit)) {
      leaveDates.add(cursor.format("YYYY/MM/DD"));
      cursor.add(1, "day");
    }
  }

  const absentRecords = await AttendanceModel.find({
    userRef: userObjId,
    date: { $gte: effStart, $lte: effEnd },
    status: AttendanceStatus.Absent,
  } as FilterQuery<Record<string, unknown>>)
    .select("date")
    .lean();
  let absentUnpaidDays = 0;
  for (const a of absentRecords) {
    // Already accounted for via the leave path — don't double-count.
    if (leaveDates.has(a.date)) continue;
    absentUnpaidDays += 1;
  }
  monthAgg.unpaidDays += absentUnpaidDays;
  // YTD bucket also needs the bump if the month is in-year (which it
  // always is for monthly slip generation), so the leave summary on the
  // slip stays internally consistent.
  ytdAgg.unpaidDays += absentUnpaidDays;

  // Aggregate paid / medical buckets from the per-type LeaveBalance docs.
  // "Medical" is identified by a case-insensitive name match on "Medical"
  // OR by code "ML" — these seed values come from leaveTypeModel defaults.
  let paidAccrued = 0;
  let paidUsedFromBalances = 0;
  let medicalAccrued = 0;
  let medicalUsedFromBalances = 0;
  // Monthly entitlement = whatever the LeaveBalance row says the user
  // gets per month (per-user override > leave-type default). Falls back
  // to `allocated / 12` when neither is set so the slip never shows a
  // misleading zero for users on legacy balance rows.
  let paidMonthlyQuota = 0;
  let medicalMonthlyQuota = 0;
  for (const b of balances) {
    const t = typeById.get(String(b.leaveType));
    if (!t) continue;
    if (t.isUnpaidBucket) continue;
    const isMedical = isMedicalType(t);
    // Resolve the effective per-month allowance for this leave type:
    //   1. Per-user override on the balance row (b.monthlyQuota).
    //   2. Leave-type default (t.monthlyQuota).
    //   3. Pro-rata across 12 months from the annual allocation.
    //   4. 0 if even that's missing.
    const perUserQuota =
      typeof b.monthlyQuota === "number" ? b.monthlyQuota : null;
    const typeQuota =
      typeof t.monthlyQuota === "number" ? t.monthlyQuota : null;
    const annual = b.allocated || 0;
    const resolvedMonthly =
      perUserQuota ??
      typeQuota ??
      (annual > 0 ? annual / 12 : 0);
    if (isMedical) {
      medicalAccrued += annual;
      medicalUsedFromBalances += b.used || 0;
      medicalMonthlyQuota += resolvedMonthly;
    } else if (t.paid) {
      paidAccrued += annual;
      paidUsedFromBalances += b.used || 0;
      paidMonthlyQuota += resolvedMonthly;
    }
  }

  // ── Calendar-day payroll model ──
  // Full-time employees are paid a FIXED monthly salary that covers
  // every day of the month, weekends and holidays included. So the
  // per-day rate is just `monthly / days-in-month`:
  //   May → 37,812 / 31 = ₹1,220 per day
  //   Feb → 37,812 / 28 = ₹1,351 per day
  // Pro-ration for mid-month joiners / mid-month relievings uses the
  // SAME calendar yardstick: ratio = effectiveCalendarDays / totalDays.
  // So someone who joins May 15 earns 17/31 of the monthly, regardless
  // of how many Saturdays fall in those 17 days.
  //
  // We still COMPUTE `workingDays` and `effectiveWorkingDays` above for
  // the slip's reference display, but no payroll math depends on them.
  const contractualTotal =
    (config?.basic || 0) +
    (config?.hra || 0) +
    (config?.mobileReimbursement || 0) +
    (config?.booksReimbursement || 0) +
    (config?.specialAllowances || 0) +
    (config?.incentives || 0);
  const perDayRate = totalDays > 0 ? contractualTotal / totalDays : 0;
  const earningsRatio = totalDays > 0 ? effTotalDays / totalDays : 0;
  const earnings = {
    basic: Math.round((config?.basic || 0) * earningsRatio),
    hra: Math.round((config?.hra || 0) * earningsRatio),
    mobileReimbursement: Math.round(
      (config?.mobileReimbursement || 0) * earningsRatio,
    ),
    booksReimbursement: Math.round(
      (config?.booksReimbursement || 0) * earningsRatio,
    ),
    specialAllowances: Math.round(
      (config?.specialAllowances || 0) * earningsRatio,
    ),
    incentives: Math.round((config?.incentives || 0) * earningsRatio),
    total: 0,
  };
  earnings.total =
    earnings.basic +
    earnings.hra +
    earnings.mobileReimbursement +
    earnings.booksReimbursement +
    earnings.specialAllowances +
    earnings.incentives;

  // ── Present days + LOP ──
  // `presentDays` = effective CALENDAR days minus in-range unpaid days
  // (real leaves + absent attendance the employee actually missed).
  // `lopDeduction` covers only real misses — out-of-range days
  // (pre-DOJ, post-today, post-relieving) are already absent from the
  // pro-rated gross so they aren't deducted twice.
  const presentDays = Math.max(effTotalDays - monthAgg.unpaidDays, 0);
  const inRangeLopDays = monthAgg.unpaidDays;
  const lopDeduction = Math.round(perDayRate * inRangeLopDays);

  const deductions = {
    pf: config?.pf || 0,
    // Standard statutory deduction — flat ₹208 / month. `?? 208` (not
    // `|| 208`) so an explicit zero in a config override stays as zero,
    // but legacy configs with the field literally undefined still get
    // the standard amount applied.
    professionalTax: config?.professionalTax ?? 208,
    tds: config?.tds || 0,
    // Only HR's configured value — no auto-added proration.
    otherDeductions: config?.otherDeductions || 0,
    lopDeduction,
    total: 0,
  };
  deductions.total =
    deductions.pf +
    deductions.professionalTax +
    deductions.tds +
    deductions.otherDeductions +
    deductions.lopDeduction;

  const netPay = Math.max(earnings.total - deductions.total, 0);
  const netPayWords =
    currency === "INR"
      ? `INR ${numToIndianWords(netPay)} only`
      : `USD ${numToIndianWords(netPay)} only`;

  const fullName = [profile?.name, user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() || user.email;

  // Designation fallback chain:
  //   1. UserProfile.designation — the canonical place. Set by EditSlip's
  //      write-back or by direct profile edit.
  //   2. Most recent prior slip for this user that has a non-empty
  //      designation — covers the case where the user never had a
  //      UserProfile row (so the EditSlip write-back silently no-op'd),
  //      but HR did set a designation on May's slip and now wants June
  //      to carry it over.
  // Empty string only falls through when there's no source anywhere.
  let designation = profile?.designation || "";
  if (!designation) {
    const lastSlipWithDesignation = await SalarySlipModel.findOne({
      user: userObjId,
      designation: { $ne: "" },
    })
      .sort({ year: -1, month: -1 })
      .select("designation")
      .lean();
    if (lastSlipWithDesignation?.designation) {
      designation = lastSlipWithDesignation.designation;
    }
  }

  // `presentDays` already computed above using the effective slice.

  return {
    user: userObjId,
    year,
    month,
    employeeName: profile?.name || fullName,
    employeeId: profile?.employeeId || "",
    designation,
    dateOfJoining: profile?.dateOfJoining || undefined,
    country,
    currency,
    totalDays,
    weekendDays,
    holidays,
    workingDays,
    presentDays,
    earnings,
    deductions,
    leaves: {
      // YTD figures — retained for historical slips + internal calc.
      // The printable slip now prefers the monthly fields below.
      paidAccrued,
      paidUsed: Math.max(ytdAgg.paidUsed, paidUsedFromBalances),
      paidBalance: Math.max(paidAccrued - Math.max(ytdAgg.paidUsed, paidUsedFromBalances), 0),
      medicalAccrued,
      medicalUsed: Math.max(ytdAgg.medicalUsed, medicalUsedFromBalances),
      medicalBalance: Math.max(medicalAccrued - Math.max(ytdAgg.medicalUsed, medicalUsedFromBalances), 0),
      // ── This month ──
      // What the employee was entitled to in the payroll period and
      // what they actually used. These are what the slip shows so the
      // employee can't mis-read a YTD balance as available-now.
      paidMonthlyQuota,
      paidUsedThisMonth: monthAgg.paidUsed,
      medicalMonthlyQuota,
      medicalUsedThisMonth: monthAgg.medicalUsed,
      unpaidDays: monthAgg.unpaidDays,
      bonusPaid: 0,
      bonusMedical: 0,
    },
    perDayRate: Math.round(perDayRate * 100) / 100,
    netPay,
    netPayWords,
    generatedAt: new Date(),
  } as SlipPayload;
}
