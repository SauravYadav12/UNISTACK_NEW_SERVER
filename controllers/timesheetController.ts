import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import moment from "moment";
import { TimesheetModel } from "../models/timesheetModel";
import { TimesheetApprovalModel } from "../models/timesheetApprovalModel";
import { ProjectModel } from "../models/projectModel";
import { InvoiceModel } from "../models/invoiceModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { ITimesheetEntry } from "../interface/modelInterfaces";
import { UserRole } from "../enums/UserEnum";
import { buildDraftFromApproval } from "../services/invoiceService";

/** Day count for a YYYY-MM month — handles leap years correctly. */
function daysInMonth(periodMonth: string): number {
  const m = moment(periodMonth + "-01", "YYYY-MM-DD", true);
  if (!m.isValid()) throw new Error(`Invalid periodMonth: ${periodMonth}`);
  return m.daysInMonth();
}

function expectedDates(periodMonth: string): string[] {
  const n = daysInMonth(periodMonth);
  const start = moment(periodMonth + "-01", "YYYY-MM-DD", true);
  return Array.from({ length: n }, (_, i) =>
    start.clone().add(i, "day").format("YYYY-MM-DD")
  );
}

function sumHours(entries: ITimesheetEntry[]): number {
  return entries.reduce(
    (acc, e) => acc + (Number.isFinite(e.hours) ? e.hours : 0),
    0
  );
}

function allDaysFilled(entries: ITimesheetEntry[]): boolean {
  // "Filled" means the admin has explicitly entered a value (including 0).
  // We represent unfilled as NaN in transit; server coerces those to 0 for
  // storage but the `allFilled` flag only goes true when every entry arrived
  // as a finite number from the client.
  return entries.every((e) => Number.isFinite(e.hours));
}

function validateEntries(
  raw: unknown,
  periodMonth: string
):
  | { ok: true; value: ITimesheetEntry[]; allFilled: boolean }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "entries must be an array" };
  const expected = expectedDates(periodMonth);
  if (raw.length !== expected.length) {
    return {
      ok: false,
      error: `entries must have ${expected.length} items for ${periodMonth}`,
    };
  }

  const out: ITimesheetEntry[] = [];
  let allFilled = true;

  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as { date?: unknown; hours?: unknown } | null;
    if (!e || typeof e !== "object") {
      return { ok: false, error: "each entry must be an object" };
    }
    if (e.date !== expected[i]) {
      return {
        ok: false,
        error: `entries[${i}].date must equal ${expected[i]}`,
      };
    }
    const h = e.hours;
    if (h === null || h === undefined) {
      out.push({ date: expected[i], hours: 0 });
      allFilled = false;
      continue;
    }
    if (typeof h !== "number" || !Number.isFinite(h) || h < 0 || h > 24) {
      return {
        ok: false,
        error: `entries[${i}].hours must be 0–24 or null`,
      };
    }
    out.push({ date: expected[i], hours: h });
  }

  return { ok: true, value: out, allFilled };
}

function isAdminLike(req: Request): boolean {
  const roles = (req.user as { role?: string[] } | undefined)?.role || [];
  return roles.includes(UserRole.SuperAdmin) || roles.includes(UserRole.Admin);
}

export const getAllTimesheets = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.timesheet);
    const { options, instance } = await paginationInstance(iQuery, TimesheetModel);
    const { startIndex, query, limit } = options;
    const results = await TimesheetModel.find(query)
      .sort({ periodMonth: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    res.status(200).json({ status: "success", data: { ...instance, results } });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** Return the single monthly timesheet for (project, periodMonth), or null. */
export const getTimesheetByMonth = async (req: Request, res: Response) => {
  try {
    const { projectRef, periodMonth } = req.query as {
      projectRef?: string;
      periodMonth?: string;
    };
    if (!projectRef || !periodMonth) {
      res
        .status(400)
        .json({ status: "failed", message: "projectRef and periodMonth are required" });
      return;
    }
    const doc = await TimesheetModel.findOne({
      projectRef: new Types.ObjectId(projectRef),
      periodMonth,
    });
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Upsert a month's timesheet. Body:
 *   { projectRef, periodMonth, entries: [{date, hours|null}], notes? }
 *
 * Side-effect: if an existing Draft invoice is associated with this project-
 * month (via approvalRef or auto-generated override), its line items are
 * rebuilt from the new hours. Raised / Paid / Due invoices are never touched.
 *
 * Edit lock behavior:
 *  - If an approval exists in Requested/Approved and the caller is NOT
 *    admin/super-admin → 409 (keeps marketing/PC honest).
 *  - Admin/super-admin can always edit.
 */
export const upsertTimesheet = async (req: Request, res: Response) => {
  try {
    const { projectRef, periodMonth, entries: rawEntries, notes } = req.body as {
      projectRef?: string;
      periodMonth?: string;
      entries?: unknown;
      notes?: string;
    };

    if (!projectRef) {
      res.status(400).json({ status: "failed", message: "projectRef is required" });
      return;
    }
    if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) {
      res.status(400).json({ status: "failed", message: "periodMonth must be YYYY-MM" });
      return;
    }

    const project = await ProjectModel.findById(projectRef);
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    if (!project.organizationRef) {
      res.status(400).json({
        status: "failed",
        message:
          "Project has no organization — assign one before filling timesheets",
      });
      return;
    }

    if (!isAdminLike(req)) {
      const approval = await TimesheetApprovalModel.findOne({
        projectRef: project._id,
        periodMonth,
      });
      if (approval && ["Requested", "Approved"].includes(approval.status)) {
        res.status(409).json({
          status: "failed",
          message: `This month is ${approval.status.toLowerCase()} — ask an admin to edit.`,
        });
        return;
      }
    }

    const entriesCheck = validateEntries(rawEntries, periodMonth);
    if (!entriesCheck.ok) {
      res.status(400).json({ status: "failed", message: entriesCheck.error });
      return;
    }

    const user = req.user as
      | { firstName?: string; lastName?: string; email?: string }
      | undefined;
    const filledBy = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
      : undefined;

    const doc = await TimesheetModel.findOneAndUpdate(
      { projectRef: project._id, periodMonth },
      {
        $set: {
          projectRef: project._id,
          projectId: project.projectId,
          organizationRef: project.organizationRef,
          periodMonth,
          entries: entriesCheck.value,
          totalHours: sumHours(entriesCheck.value),
          allFilled: entriesCheck.allFilled,
          // Any edit invalidates a prior "Mark complete" — admin has to
          // re-confirm the month is finalised before it can be submitted again.
          completed: false,
          completedAt: undefined,
          completedBy: undefined,
          filledBy,
          notes,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // If a Draft invoice already exists for this project-month, rebuild its
    // line items from the new totals. We only touch Draft — Raised/Paid/Due
    // must stay stable for billing audit.
    try {
      const invoice = await InvoiceModel.findOne({
        projectRef: project._id,
        periodMonth,
        status: "Draft",
      });
      if (invoice) {
        const approval = await TimesheetApprovalModel.findOne({
          projectRef: project._id,
          periodMonth,
        });
        if (approval) {
          await invoice.deleteOne();
          await buildDraftFromApproval(approval);
        }
      }
    } catch (e) {
      console.warn("[timesheet] draft regeneration failed:", getErrorMessage(e));
    }

    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Flip the timesheet's `completed` flag. Required before Submit-for-approval
 * — forces a confirmation gesture from the admin. Body: { projectRef, periodMonth }.
 */
export const markTimesheetComplete = async (req: Request, res: Response) => {
  try {
    const { projectRef, periodMonth } = req.body as {
      projectRef?: string;
      periodMonth?: string;
    };
    if (!projectRef || !periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) {
      res.status(400).json({
        status: "failed",
        message: "projectRef and periodMonth (YYYY-MM) are required",
      });
      return;
    }

    const doc = await TimesheetModel.findOne({
      projectRef: new Types.ObjectId(projectRef),
      periodMonth,
    });
    if (!doc) {
      res
        .status(404)
        .json({ status: "failed", message: "Save the month before marking it complete" });
      return;
    }

    // Same edit-lock rules as upsert — locked months can't be re-confirmed
    // by non-admins.
    if (!isAdminLike(req)) {
      const approval = await TimesheetApprovalModel.findOne({
        projectRef: doc.projectRef,
        periodMonth: doc.periodMonth,
      });
      if (approval && ["Requested", "Approved"].includes(approval.status)) {
        res.status(409).json({
          status: "failed",
          message: `This month is ${approval.status.toLowerCase()} — no further action needed.`,
        });
        return;
      }
    }

    const user = req.user as
      | { firstName?: string; lastName?: string; email?: string }
      | undefined;
    const by = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
      : undefined;

    doc.completed = true;
    doc.completedAt = new Date();
    doc.completedBy = by;
    await doc.save();

    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Append a screenshot to the monthly timesheet. Body either:
 *   { slotId, url, fileName, sizeBytes? }     — modern, slot-based path
 *   { weekStart, weekEnd, weekLabel?, url, fileName, sizeBytes? } — legacy
 * Called after the admin uploads an image via /storage/upload/timesheet-screenshot.
 */
export const addTimesheetScreenshot = async (req: Request, res: Response) => {
  try {
    const doc = await TimesheetModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Timesheet not found" });
      return;
    }
    const {
      slotId,
      weekStart,
      weekEnd,
      weekLabel,
      url,
      fileName,
      sizeBytes,
    } = req.body as {
      slotId?: string;
      weekStart?: string;
      weekEnd?: string;
      weekLabel?: string;
      url?: string;
      fileName?: string;
      sizeBytes?: number;
    };
    if (!url || !fileName) {
      res.status(400).json({
        status: "failed",
        message: "url and fileName are required",
      });
      return;
    }
    let resolvedLabel = weekLabel;
    if (slotId) {
      const slot = (doc.screenshotSlots || []).find(
        (s) => String((s as unknown as { _id: unknown })._id) === slotId,
      );
      if (!slot) {
        res
          .status(404)
          .json({ status: "failed", message: "Slot not found on this timesheet" });
        return;
      }
      resolvedLabel = slot.label || weekLabel;
    } else if (!weekStart || !weekEnd) {
      // Legacy path still requires the date pair so existing API consumers
      // keep working.
      res.status(400).json({
        status: "failed",
        message:
          "slotId is required (or supply weekStart + weekEnd for legacy callers)",
      });
      return;
    }

    const user = req.user as
      | { firstName?: string; lastName?: string; email?: string }
      | undefined;
    const uploadedBy = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
      : undefined;

    // Typing note: $push on an embedded array tickles mongoose 5's strict
    // checks. Cast the payload to bypass the narrow types — runtime is fine.
    doc.screenshots = [
      ...(doc.screenshots || []),
      {
        slotId,
        weekStart,
        weekEnd,
        weekLabel: resolvedLabel,
        url,
        fileName,
        sizeBytes,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
      } as unknown as NonNullable<typeof doc.screenshots>[number],
    ];
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Replace the timesheet's screenshot-slot list. Body:
 *   { slots: Array<{ _id?: string; label: string }> }
 * Slots without _id get a fresh ObjectId. Any screenshot whose slotId is no
 * longer present in the new list is dropped — the UI can't render orphans.
 */
export const setTimesheetScreenshotSlots = async (
  req: Request,
  res: Response,
) => {
  try {
    const doc = await TimesheetModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Timesheet not found" });
      return;
    }
    const { slots } = req.body as {
      slots?: Array<{
        _id?: string;
        label?: string;
        /** Backfill hint — when present, legacy screenshots whose
         *  weekStart/weekEnd match are auto-bound to this slot. */
        weekStart?: string;
        weekEnd?: string;
      }>;
    };
    if (!Array.isArray(slots)) {
      res
        .status(400)
        .json({ status: "failed", message: "slots must be an array" });
      return;
    }
    const normalized = slots.map((s) => ({
      _id: s._id || new mongoose.Types.ObjectId().toString(),
      label: typeof s.label === "string" ? s.label : "",
      _weekStart: s.weekStart,
      _weekEnd: s.weekEnd,
    }));
    doc.screenshotSlots = normalized.map((s) => ({
      _id: s._id,
      label: s.label,
    })) as unknown as NonNullable<typeof doc.screenshotSlots>;
    const validIds = new Set(normalized.map((s) => s._id));
    // First, backfill legacy screenshots: any row without a slotId whose
    // weekStart/weekEnd match a slot's hint gets re-bound to that slot.
    // Then drop screenshots whose slotId is no longer in the valid set
    // (and which aren't a still-unbound legacy row).
    doc.screenshots = (doc.screenshots || [])
      .map((s) => {
        if (s.slotId) return s;
        const match = normalized.find(
          (slot) =>
            slot._weekStart &&
            slot._weekEnd &&
            slot._weekStart === s.weekStart &&
            slot._weekEnd === s.weekEnd,
        );
        if (match) {
          (s as unknown as { slotId: string }).slotId = match._id;
        }
        return s;
      })
      .filter((s) => !s.slotId || validIds.has(s.slotId));
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const removeTimesheetScreenshot = async (req: Request, res: Response) => {
  try {
    const doc = await TimesheetModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Timesheet not found" });
      return;
    }
    const shotId = String(req.params.shotId);
    doc.screenshots = (doc.screenshots || []).filter(
      (s) => String((s as unknown as { _id: unknown })._id) !== shotId
    );
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const deleteTimesheet = async (req: Request, res: Response) => {
  try {
    const doc = await TimesheetModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Timesheet not found" });
      return;
    }
    // Non-admins can't delete timesheets for months under review/approved.
    if (!isAdminLike(req)) {
      const approval = await TimesheetApprovalModel.findOne({
        projectRef: doc.projectRef,
        periodMonth: doc.periodMonth,
      });
      if (approval && ["Requested", "Approved"].includes(approval.status)) {
        res.status(409).json({
          status: "failed",
          message: `Cannot delete — month is ${approval.status.toLowerCase()}`,
        });
        return;
      }
    }
    await doc.deleteOne();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
