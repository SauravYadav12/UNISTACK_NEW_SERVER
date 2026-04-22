import { Request, Response } from "express";
import moment from "moment";
import { InvoiceModel } from "../models/invoiceModel";
import { ProjectModel } from "../models/projectModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { Types } from "mongoose";
import { computeDueDate, rebuildTotals } from "../utils/billingMath";
import {
  collectInvoiceRecipients,
  sendInvoiceRaisedEmail,
} from "../services/invoiceEmailService";
import { buildDraftOverride } from "../services/invoiceService";
import { UserRole } from "../enums/UserEnum";

export const getAllInvoices = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.invoice);
    const { options, instance } = await paginationInstance(iQuery, InvoiceModel);
    const { startIndex, query, limit } = options;
    const results = await InvoiceModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    res.status(200).json({ status: "success", data: { ...instance, results } });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Admin/super-admin override: create a Draft invoice for (project, month)
 * without routing through the submit/approve flow.
 * Body: { projectRef, periodMonth }
 */
export const generateDraftOverride = async (req: Request, res: Response) => {
  try {
    const roles = (req.user as { role?: string[] } | undefined)?.role || [];
    if (
      !roles.includes(UserRole.SuperAdmin) &&
      !roles.includes(UserRole.Admin)
    ) {
      res.status(403).json({
        status: "failed",
        message: "Only admin/super-admin can skip approval",
      });
      return;
    }

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

    // 409 if there's already any invoice for this project-month.
    const existing = await InvoiceModel.findOne({
      projectRef: new Types.ObjectId(projectRef),
      periodMonth,
    });
    if (existing) {
      res.status(409).json({
        status: "failed",
        message: `An invoice (${existing.invoiceNumber}) already exists for ${periodMonth}`,
      });
      return;
    }

    const user = req.user as { _id?: Types.ObjectId } | undefined;
    const invoice = await buildDraftOverride({
      projectId: projectRef,
      periodMonth,
      createdByUser: user?._id,
    });
    res.status(200).json({ status: "success", data: invoice });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const getInvoiceById = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Patch Draft invoices only. Callers may change lineItems / taxPercent /
 * taxLabel / notes / currency. Totals re-derive on save.
 */
export const updateInvoice = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (doc.status !== "Draft") {
      res.status(409).json({
        status: "failed",
        message: `Cannot edit an invoice in status ${doc.status}`,
      });
      return;
    }
    const body = req.body as {
      lineItems?: unknown;
      taxPercent?: number;
      taxLabel?: string;
      notes?: string;
      currency?: string;
      // Admin/super-admin only — see role check below
      invoiceNumber?: string;
      issueDate?: string;
    };
    if (Array.isArray(body.lineItems)) {
      doc.lineItems = body.lineItems as typeof doc.lineItems;
    }
    if (typeof body.taxPercent === "number") doc.taxPercent = body.taxPercent;
    if (typeof body.taxLabel === "string") doc.taxLabel = body.taxLabel;
    if (typeof body.notes === "string") doc.notes = body.notes;
    if (typeof body.currency === "string") doc.currency = body.currency;

    // Invoice number + issue date are privileged — only admin/super-admin can
    // override the auto-generated values. Silently ignored for other roles so
    // the rest of the patch still succeeds.
    const roles = (req.user as { role?: string[] } | undefined)?.role || [];
    const isPrivileged =
      roles.includes(UserRole.SuperAdmin) || roles.includes(UserRole.Admin);
    if (isPrivileged && typeof body.invoiceNumber === "string") {
      const next = body.invoiceNumber.trim();
      if (!next) {
        res.status(400).json({
          status: "failed",
          message: "invoiceNumber cannot be empty",
        });
        return;
      }
      if (!/^[A-Za-z0-9-]{3,40}$/.test(next)) {
        res.status(400).json({
          status: "failed",
          message: "invoiceNumber must be 3–40 chars — letters, digits, hyphens",
        });
        return;
      }
      if (next !== doc.invoiceNumber) {
        const clash = await InvoiceModel.findOne({
          invoiceNumber: next,
          _id: { $ne: doc._id },
        });
        if (clash) {
          res.status(409).json({
            status: "failed",
            code: "INVOICE_NUMBER_TAKEN",
            message: `Invoice number "${next}" is already in use`,
          });
          return;
        }
        doc.invoiceNumber = next;
      }
    }
    if (isPrivileged && typeof body.issueDate === "string") {
      if (body.issueDate === "") {
        doc.issueDate = undefined;
      } else if (moment(body.issueDate, "YYYY-MM-DD", true).isValid()) {
        doc.issueDate = body.issueDate;
      } else {
        res.status(400).json({
          status: "failed",
          message: "issueDate must be YYYY-MM-DD",
        });
        return;
      }
    }

    // Belt-and-braces — the pre-save hook on InvoiceModel also does this.
    const t = rebuildTotals(doc.lineItems, doc.taxPercent);
    doc.subtotal = t.subtotal;
    doc.taxAmount = t.taxAmount;
    doc.total = t.total;

    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Flip Draft → Raised. Computes dueDate from the project's payment terms,
 * fires the recipient email, and records emailedTo[] + emailedAt.
 * Invoice stays Raised even if email send fails — caller can resend.
 */
export const raiseInvoice = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (doc.status !== "Draft") {
      res.status(409).json({
        status: "failed",
        message: `Cannot raise from status ${doc.status}`,
      });
      return;
    }

    const project = await ProjectModel.findById(doc.projectRef);
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }

    const { issueDate, to, cc, subject, body, pdfUrl } = req.body as {
      issueDate?: string;
      to?: string[];
      cc?: string[];
      subject?: string;
      body?: string;
      pdfUrl?: string;
    };

    const issue =
      issueDate && moment(issueDate, "YYYY-MM-DD", true).isValid()
        ? issueDate
        : moment().format("YYYY-MM-DD");

    const termDays = project.paymentTerms?.days ?? 30;
    const due = computeDueDate(issue, termDays);

    if (typeof pdfUrl === "string" && pdfUrl.length) doc.pdfUrl = pdfUrl;
    doc.issueDate = issue;
    doc.dueDate = due;
    doc.status = "Raised";

    // Client-driven recipients take precedence — admins edit To/CC in the
    // email dialog before send. Fall back to the project's defaults if
    // nothing was provided (kept for API tooling that doesn't render the UI).
    const toList = (to || []).filter((e) => e && e.includes("@"));
    const ccList = (cc || []).filter((e) => e && e.includes("@"));
    const recipients =
      toList.length > 0 ? toList : collectInvoiceRecipients(project);
    doc.emailedTo = [...recipients, ...ccList];

    try {
      if (recipients.length) {
        await sendInvoiceRaisedEmail({
          invoice: doc,
          project,
          to: recipients,
          cc: ccList,
          subject,
          body,
        });
        doc.emailedAt = new Date();
      } else {
        console.warn(
          `[invoice] ${doc.invoiceNumber} raised but no recipients configured`
        );
      }
    } catch (e) {
      console.warn("[invoice] raise email failed:", e);
    }

    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const markPaid = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (!["Raised", "Due"].includes(doc.status)) {
      res.status(409).json({
        status: "failed",
        message: `Cannot mark paid from status ${doc.status}`,
      });
      return;
    }
    const { paidOn, paymentReference, paymentNotes } = req.body as {
      paidOn?: string;
      paymentReference?: string;
      paymentNotes?: string;
    };
    if (!paidOn || !moment(paidOn, "YYYY-MM-DD", true).isValid()) {
      res
        .status(400)
        .json({ status: "failed", message: "paidOn (YYYY-MM-DD) is required" });
      return;
    }
    doc.status = "Paid";
    doc.paidOn = paidOn;
    doc.paymentReference = paymentReference;
    doc.paymentNotes = paymentNotes;
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const markUnpaid = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (doc.status !== "Paid") {
      res.status(409).json({
        status: "failed",
        message: "Only Paid invoices can be reverted",
      });
      return;
    }
    doc.paidOn = undefined;
    doc.paymentReference = undefined;
    doc.paymentNotes = undefined;
    // Recompute whether it's Raised or Due based on dueDate.
    const today = moment().format("YYYY-MM-DD");
    doc.status = doc.dueDate && doc.dueDate < today ? "Due" : "Raised";
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const resendInvoiceEmail = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (!["Raised", "Due"].includes(doc.status)) {
      res.status(409).json({
        status: "failed",
        message: "Only Raised/Due invoices can be resent",
      });
      return;
    }
    const project = await ProjectModel.findById(doc.projectRef);
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    const { recipientOverride } = req.body as { recipientOverride?: string[] };
    const recipients = collectInvoiceRecipients(project, recipientOverride);
    if (!recipients.length) {
      res.status(400).json({
        status: "failed",
        message: "No recipients configured on the project",
      });
      return;
    }
    await sendInvoiceRaisedEmail({ invoice: doc, project, to: recipients });
    doc.emailedTo = recipients;
    doc.emailedAt = new Date();
    await doc.save();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    const doc = await InvoiceModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Invoice not found" });
      return;
    }
    if (doc.status !== "Draft") {
      res.status(409).json({
        status: "failed",
        message: "Only Draft invoices can be deleted",
      });
      return;
    }
    await doc.deleteOne();
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
