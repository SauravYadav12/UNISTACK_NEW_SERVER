import { Request, Response } from "express";
import { Types } from "mongoose";
import { TimesheetApprovalModel } from "../models/timesheetApprovalModel";
import { TimesheetModel } from "../models/timesheetModel";
import { ProjectModel } from "../models/projectModel";
import { UserModel } from "../models/userModel";
import { InvoiceModel } from "../models/invoiceModel";
import { buildDraftFromApproval } from "../services/invoiceService";
import { sendTimesheetApprovalEmail } from "../services/invoiceEmailService";
import { emitNotification } from "../services/notificationService";
import { getErrorMessage } from "../utils/utils";
import { UserRole } from "../enums/UserEnum";

export const getApproval = async (req: Request, res: Response) => {
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
    const doc = await TimesheetApprovalModel.findOne({
      projectRef: new Types.ObjectId(projectRef),
      periodMonth,
    });
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * List timesheet-approval docs filtered by status and/or org/project.
 * Used by the "Approvals inbox" sidebar page — super-admins see every
 * Requested approval across projects at a glance.
 */
export const listApprovals = async (req: Request, res: Response) => {
  try {
    const { status, projectRef, organizationRef } = req.query as {
      status?: string;
      projectRef?: string;
      organizationRef?: string;
    };
    const q: Record<string, unknown> = {};
    if (status) q.status = status;
    if (projectRef) q.projectRef = projectRef;
    if (organizationRef) q.organizationRef = organizationRef;

    const results = await TimesheetApprovalModel.find(q)
      .sort({ requestedAt: -1, createdAt: -1 })
      .limit(500)
      .lean();

    res.status(200).json({
      status: "success",
      data: { results, totalDocuments: results.length },
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const getApprovalById = async (req: Request, res: Response) => {
  try {
    const doc = await TimesheetApprovalModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Approval not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Admin clicks "Submit for approval" for a project-month.
 * Validates there's at least one timesheet for the month, snapshots the IDs,
 * moves status to Requested, and fires the approval email to super-admins.
 * Works as an upsert so the same approval doc carries the record across
 * Rejected → re-submit cycles.
 */
export const submitForApproval = async (req: Request, res: Response) => {
  try {
    const { projectRef, periodMonth } = req.body as {
      projectRef?: string;
      periodMonth?: string;
    };
    if (!projectRef || !periodMonth) {
      res.status(400).json({
        status: "failed",
        message: "projectRef and periodMonth are required",
      });
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
      res.status(400).json({
        status: "failed",
        message: "periodMonth must be formatted YYYY-MM",
      });
      return;
    }

    const project = await ProjectModel.findById(projectRef);
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }

    // Prevent re-submit while already Requested or Approved.
    const existing = await TimesheetApprovalModel.findOne({
      projectRef: project._id,
      periodMonth,
    });
    if (existing && ["Requested", "Approved"].includes(existing.status)) {
      res.status(409).json({
        status: "failed",
        message: `Already ${existing.status.toLowerCase()}`,
      });
      return;
    }

    const weeks = await TimesheetModel.find({
      projectRef: project._id,
      periodMonth,
    });
    if (!weeks.length) {
      res.status(400).json({
        status: "failed",
        message: "No timesheets saved for this month yet.",
      });
      return;
    }

    // Server-side mirror of the "Mark complete" UI gate — the admin must
    // have explicitly confirmed finalisation before this can be submitted.
    if (!weeks.every((w) => w.completed)) {
      res.status(409).json({
        status: "failed",
        message:
          "Mark the month as complete before submitting it for approval.",
      });
      return;
    }

    const totalHours = weeks.reduce((acc, w) => acc + (w.totalHours || 0), 0);
    const timesheetIds = weeks.map((w) => w._id as Types.ObjectId);

    const user = req.user as
      | { _id?: Types.ObjectId; firstName?: string; lastName?: string; email?: string }
      | undefined;
    const requestedByLabel = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown"
      : "Unknown";

    const doc = await TimesheetApprovalModel.findOneAndUpdate(
      { projectRef: project._id, periodMonth },
      {
        $set: {
          projectRef: project._id,
          projectId: project.projectId,
          organizationRef: project.organizationRef,
          periodMonth,
          status: "Requested",
          timesheetIds,
          totalHoursAtSubmission: totalHours,
          requestedAt: new Date(),
          requestedBy: user?._id,
          rejectionReason: undefined,
          rejectedAt: undefined,
          rejectedBy: undefined,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Fire email (best-effort — state is already persisted).
    try {
      const supers = await UserModel.find({
        role: UserRole.SuperAdmin,
        active: true,
      }).select("email");
      // Recipients: every super-admin + info@unicodez.com (always CC'd so the
      // ops inbox sees the request too). Dedupe to avoid double-sends.
      const recipients = new Set<string>();
      for (const u of supers) {
        if (u.email) recipients.add(u.email);
      }
      recipients.add("info@unicodez.com");
      await sendTimesheetApprovalEmail({
        approval: doc,
        project,
        superAdminEmails: [...recipients],
        requestedByLabel,
      });
    } catch (e) {
      console.warn("[approval] submit email failed:", e);
    }

    // Notification — fan out to every active super-admin. They review and
    // act on the approval; the in-app bell complements the email so they
    // don't have to hunt through Gmail.
    const superAdminIds = await UserModel.distinct("_id", {
      role: UserRole.SuperAdmin,
      active: true,
    });
    void emitNotification({
      recipients: superAdminIds,
      type: "TIMESHEET_APPROVAL_REQUESTED",
      title: `Timesheet approval requested: ${project.projectId} · ${periodMonth}`,
      body: `${requestedByLabel} submitted ${totalHours}h for ${project.projectId} (${periodMonth}). Review and approve.`,
      link: {
        kind: "timesheet",
        projectId: project.projectId,
        approvalId: String(doc._id),
        periodMonth,
      },
      actor: user
        ? {
            _id: user._id,
            name: requestedByLabel,
          }
        : undefined,
    });

    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const approveApproval = async (req: Request, res: Response) => {
  try {
    const approval = await TimesheetApprovalModel.findById(req.params.id);
    if (!approval) {
      res.status(404).json({ status: "failed", message: "Approval not found" });
      return;
    }
    if (approval.status !== "Requested") {
      res.status(409).json({
        status: "failed",
        message: `Cannot approve from status ${approval.status}`,
      });
      return;
    }

    const user = req.user as { _id?: Types.ObjectId } | undefined;
    approval.status = "Approved";
    approval.approvedAt = new Date();
    approval.approvedBy = user?._id;
    await approval.save();

    // Build the invoice draft. If this fails we revert the approval to
    // Requested so the admin can retry — partial state is worse than no state.
    let invoice;
    try {
      invoice = await buildDraftFromApproval(approval);
      approval.generatedInvoiceRef = invoice._id;
      await approval.save();
    } catch (e) {
      approval.status = "Requested";
      approval.approvedAt = undefined;
      approval.approvedBy = undefined;
      await approval.save();
      res.status(500).json({
        status: "failed",
        message: `Approved, but invoice draft failed: ${getErrorMessage(e)}`,
      });
      return;
    }

    // Notify the requester their submission was approved + the invoice was drafted.
    if (approval.requestedBy) {
      const actor = req.user as
        | { _id?: Types.ObjectId; firstName?: string; lastName?: string; email?: string }
        | undefined;
      void emitNotification({
        recipients: [approval.requestedBy],
        type: "TIMESHEET_APPROVAL_APPROVED",
        title: `Timesheet approved: ${approval.projectId} · ${approval.periodMonth}`,
        body: `Your ${approval.periodMonth} timesheet (${approval.totalHoursAtSubmission || 0}h) was approved. Invoice draft generated.`,
        link: {
          kind: "timesheet",
          projectId: approval.projectId,
          approvalId: String(approval._id),
          periodMonth: approval.periodMonth,
        },
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

    res.status(200).json({
      status: "success",
      data: { approval, invoice },
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const rejectApproval = async (req: Request, res: Response) => {
  try {
    const approval = await TimesheetApprovalModel.findById(req.params.id);
    if (!approval) {
      res.status(404).json({ status: "failed", message: "Approval not found" });
      return;
    }
    if (approval.status !== "Requested") {
      res.status(409).json({
        status: "failed",
        message: `Cannot reject from status ${approval.status}`,
      });
      return;
    }
    const { reason } = req.body as { reason?: string };
    const user = req.user as { _id?: Types.ObjectId } | undefined;

    approval.status = "Rejected";
    approval.rejectionReason = reason?.trim() || "No reason provided";
    approval.rejectedAt = new Date();
    approval.rejectedBy = user?._id;
    await approval.save();

    // Notify the requester their submission was rejected with the reason.
    if (approval.requestedBy) {
      const actor = req.user as
        | { _id?: Types.ObjectId; firstName?: string; lastName?: string; email?: string }
        | undefined;
      void emitNotification({
        recipients: [approval.requestedBy],
        type: "TIMESHEET_APPROVAL_REJECTED",
        title: `Timesheet rejected: ${approval.projectId} · ${approval.periodMonth}`,
        body: `Your ${approval.periodMonth} timesheet was rejected. Reason: ${approval.rejectionReason}`,
        link: {
          kind: "timesheet",
          projectId: approval.projectId,
          approvalId: String(approval._id),
          periodMonth: approval.periodMonth,
        },
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

    res.status(200).json({ status: "success", data: approval });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
