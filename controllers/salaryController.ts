import { Request, Response } from "express";
import { Types } from "mongoose";
import { SalaryConfigModel } from "../models/salaryConfigModel";
import { SalarySlipModel } from "../models/salarySlipModel";
import { UserModel } from "../models/userModel";
import { UserDoc } from "../interface";
import { UserRole } from "../enums/UserEnum";
import { computeSalarySlip, numToIndianWords } from "../services/salaryCalculationService";
import { syncNationalHolidays } from "../services/holidaySyncService";
import { emitNotification } from "../services/notificationService";

// Super-admins are not employees on payroll — exclude them from slip
// generation, monthly listings, and CSV exports so HR doesn't see them
// in payroll surfaces. The role is excluded structurally (not just via
// UI filters) so a manual API call also can't accidentally produce a slip.
const NOT_SUPER_ADMIN_FILTER = { role: { $ne: UserRole.SuperAdmin } };

function currentYearMonth(req: Request) {
  const now = new Date();
  const year = Number(req.params.year || now.getFullYear());
  const month = Number(req.params.month || now.getMonth() + 1);
  return { year, month };
}

function oid(id: string | Types.ObjectId) {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

function pickUserId(req: Request) {
  const raw = req.params.userId;
  return Array.isArray(raw) ? raw[0] : raw;
}

export const getSalaryConfig = async (req: Request, res: Response) => {
  try {
    const userId = pickUserId(req);
    const config = await SalaryConfigModel.findOne({ user: oid(userId) }).lean();
    res.status(200).json({ data: config });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const upsertSalaryConfig = async (req: Request, res: Response) => {
  try {
    const userId = pickUserId(req);
    const body = { ...req.body, user: oid(userId) };
    const updated = await SalaryConfigModel.findOneAndUpdate(
      { user: oid(userId) },
      body,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(200).json({ data: updated });
  } catch (error) {
    res.status(500).json({ error });
  }
};

async function generateForUser(
  userId: string,
  year: number,
  month: number,
  generatedBy?: string,
) {
  const payload = await computeSalarySlip(userId, year, month);
  const saved = await SalarySlipModel.findOneAndUpdate(
    { user: oid(userId), year, month },
    { $set: { ...payload, user: oid(userId), generatedBy: generatedBy ? oid(generatedBy) : undefined } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return saved;
}

export const generateSlipsForMonth = async (req: Request, res: Response) => {
  try {
    const { year, month } = currentYearMonth(req);
    const generatedBy = (req.user as UserDoc)._id.toString();
    const users = await UserModel.find({ active: true, ...NOT_SUPER_ADMIN_FILTER })
      .select("_id")
      .lean();
    const results = await Promise.allSettled(
      users.map((u) => generateForUser(String(u._id), year, month, generatedBy)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;

    // Event 12 — ping every employee whose slip we just generated. Only those
    // whose generation actually succeeded; failed ones get nothing.
    const okUserIds: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") okUserIds.push(String(users[i]._id));
    });
    if (okUserIds.length > 0) {
      const actor = req.user as UserDoc | undefined;
      void emitNotification({
        recipients: okUserIds,
        type: "SALARY_SLIP_GENERATED",
        title: `Your payslip for ${month}/${year} is ready`,
        body: `View and download your salary slip from the Salary page.`,
        link: { kind: "salary", slipMonth: { year, month } },
        actor: actor
          ? {
              _id: actor._id,
              name:
                `${actor.firstName || ""} ${actor.lastName || ""}`.trim() ||
                actor.email,
            }
          : undefined,
      });
    }

    res.status(200).json({ year, month, ok, failed });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const generateSlipForUser = async (req: Request, res: Response) => {
  try {
    const userId = pickUserId(req);
    // Block direct generation for super-admins AND inactive employees —
    // covers the single-user route the admin UI offers next to the bulk
    // button. Bulk generation already filters both via the active-only
    // user query in `generateSlipsForMonth`; this matches that policy
    // for the per-user path.
    const target = await UserModel.findOne({
      _id: oid(userId),
      active: true,
      ...NOT_SUPER_ADMIN_FILTER,
    })
      .select("_id")
      .lean();
    if (!target) {
      res.status(400).json({
        error: "Slips are only generated for active, non-super-admin employees",
      });
      return;
    }
    const { year, month } = currentYearMonth(req);
    const generatedBy = (req.user as UserDoc)._id.toString();
    const slip = await generateForUser(userId, year, month, generatedBy);

    // Event 12 (single-user variant).
    const actor = req.user as UserDoc | undefined;
    void emitNotification({
      recipients: [userId],
      type: "SALARY_SLIP_GENERATED",
      title: `Your payslip for ${month}/${year} is ready`,
      body: `View and download your salary slip from the Salary page.`,
      link: { kind: "salary", slipMonth: { year, month } },
      actor: actor
        ? {
            _id: actor._id,
            name:
              `${actor.firstName || ""} ${actor.lastName || ""}`.trim() ||
              actor.email,
          }
        : undefined,
    });

    res.status(200).json({ data: slip });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getSlipsForMonth = async (req: Request, res: Response) => {
  try {
    const { year, month } = currentYearMonth(req);
    // Hide slips belonging to users we don't want to show in HR surfaces:
    //   - Super-admins (system role, never on payroll).
    //   - Inactive employees (off-boarded — their historical slips stay in
    //     the DB for audit but shouldn't show in the live monthly list).
    // One $or-distinct keeps this to a single query.
    const hiddenUserIds = await UserModel.distinct("_id", {
      $or: [{ role: UserRole.SuperAdmin }, { active: false }],
    });
    const slips = await SalarySlipModel.find({
      year,
      month,
      user: { $nin: hiddenUserIds },
    })
      .sort({ employeeName: 1 })
      .lean();
    res.status(200).json({ data: slips });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getMySlip = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const { year, month } = currentYearMonth(req);
    const slip = await SalarySlipModel.findOne({
      user: oid(user._id),
      year,
      month,
    }).lean();
    // No on-the-fly computation: employees see only slips HR has generated.
    // If null, the client renders the "No payslip" empty state.
    res.status(200).json({ data: slip });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getMySlipsList = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const slips = await SalarySlipModel.find({ user: oid(user._id) })
      .sort({ year: -1, month: -1 })
      .select("year month netPay generatedAt currency")
      .lean();
    res.status(200).json({ data: slips });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const getMonthlyReportCsv = async (req: Request, res: Response) => {
  try {
    const { year, month } = currentYearMonth(req);
    // Same exclusion as the admin monthly listing — keeps super-admin AND
    // inactive employees out of the CSV export so payroll downloads are
    // clean and consistent with what HR sees on screen.
    const hiddenUserIds = await UserModel.distinct("_id", {
      $or: [{ role: UserRole.SuperAdmin }, { active: false }],
    });
    const slips = await SalarySlipModel.find({
      year,
      month,
      user: { $nin: hiddenUserIds },
    })
      .sort({ employeeName: 1 })
      .lean();

    const headers = [
      "Employee ID", "Name", "Designation", "Country", "Currency",
      "Working Days", "Present Days", "Unpaid Days",
      "Basic", "HRA", "Mobile", "Books", "Special Allow", "Incentives", "Gross",
      "PF", "Professional Tax", "TDS", "Other Ded", "LOP Ded", "Total Ded",
      "Net Pay",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const s of slips) {
      lines.push([
        s.employeeId, s.employeeName, s.designation, s.country, s.currency,
        s.workingDays, s.presentDays, s.leaves?.unpaidDays,
        s.earnings?.basic, s.earnings?.hra, s.earnings?.mobileReimbursement,
        s.earnings?.booksReimbursement, s.earnings?.specialAllowances,
        s.earnings?.incentives, s.earnings?.total,
        s.deductions?.pf, s.deductions?.professionalTax, s.deductions?.tds,
        s.deductions?.otherDeductions,
        s.deductions?.lopDeduction, s.deductions?.total,
        s.netPay,
      ].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="salary-${year}-${String(month).padStart(2, "0")}.csv"`,
    );
    res.status(200).send(lines.join("\n"));
  } catch (error) {
    res.status(500).json({ error });
  }
};

// HR adjustment: overwrite specific slip fields (earnings, deductions,
// designation, date-of-joining) and recompute derived totals + netPayWords
// so the stored slip remains internally consistent.
export const updateSlip = async (req: Request, res: Response) => {
  try {
    const { slipId } = req.params;
    const existing = await SalarySlipModel.findById(slipId);
    if (!existing) {
      res.status(404).json({ error: "Slip not found" });
      return;
    }

    const body = req.body as Partial<{
      designation: string;
      dateOfJoining: string | Date | null;
      earnings: Partial<typeof existing.earnings>;
      deductions: Partial<typeof existing.deductions>;
      leaves: Partial<typeof existing.leaves>;
      workingDays: number;
      presentDays: number;
    }>;

    if (typeof body.designation === "string") existing.designation = body.designation;
    if (body.dateOfJoining !== undefined) {
      existing.dateOfJoining = body.dateOfJoining ? new Date(body.dateOfJoining) : undefined;
    }
    if (typeof body.workingDays === "number") existing.workingDays = Math.max(0, body.workingDays);
    if (typeof body.presentDays === "number") existing.presentDays = Math.max(0, body.presentDays);

    if (body.earnings) {
      const e = existing.earnings;
      for (const k of ["basic", "hra", "mobileReimbursement", "booksReimbursement", "specialAllowances", "incentives"] as const) {
        const v = body.earnings[k];
        if (typeof v === "number" && Number.isFinite(v)) e[k] = Math.max(0, v);
      }
      e.total = e.basic + e.hra + e.mobileReimbursement + e.booksReimbursement + e.specialAllowances + e.incentives;
    }

    if (body.deductions) {
      const d = existing.deductions;
      for (const k of [
        "pf",
        "professionalTax",
        "tds",
        "otherDeductions",
        "lopDeduction",
      ] as const) {
        const v = body.deductions[k];
        if (typeof v === "number" && Number.isFinite(v)) d[k] = Math.max(0, v);
      }
      d.total =
        d.pf + d.professionalTax + d.tds + d.otherDeductions + d.lopDeduction;
    }

    if (body.leaves) {
      const l = existing.leaves;
      for (const k of ["paidAccrued", "paidUsed", "paidBalance", "medicalAccrued", "medicalUsed", "medicalBalance", "unpaidDays", "bonusPaid", "bonusMedical"] as const) {
        const v = body.leaves[k];
        if (typeof v === "number" && Number.isFinite(v)) l[k] = Math.max(0, v);
      }
    }

    // Recompute the two derived numbers that the slip view reads directly.
    existing.netPay = Math.max(existing.earnings.total - existing.deductions.total, 0);
    existing.netPayWords = existing.currency === "INR"
      ? `INR ${numToIndianWords(existing.netPay)} only`
      : `USD ${numToIndianWords(existing.netPay)} only`;
    if (existing.workingDays > 0) {
      existing.perDayRate = Math.round((existing.earnings.total / existing.workingDays) * 100) / 100;
    }

    await existing.save();
    res.status(200).json({ data: existing });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const syncHolidays = async (req: Request, res: Response) => {
  try {
    const year = Number(req.params.year || new Date().getFullYear());
    const rawCountry = Array.isArray(req.query.country)
      ? req.query.country[0]
      : req.query.country;
    const only = rawCountry === "IN" || rawCountry === "US" ? rawCountry : undefined;
    const result = await syncNationalHolidays(year, only);
    res.status(200).json({ data: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
