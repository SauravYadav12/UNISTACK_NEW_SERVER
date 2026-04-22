import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  deleteInvoice,
  generateDraftOverride,
  getAllInvoices,
  getInvoiceById,
  markPaid,
  markUnpaid,
  raiseInvoice,
  resendInvoiceEmail,
  updateInvoice,
} from "../controllers/invoiceController";

const invoiceRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const writers = anyRoleGuard(
  UserRole.SuperAdmin,
  UserRole.Admin,
  UserRole.ProjectCoordinator
);

invoiceRoute.get("/get-invoices", jwt, getAllInvoices);
// NB: `/generate-override` must precede `/:id` routes.
invoiceRoute.post("/generate-override", jwt, writers, generateDraftOverride);
invoiceRoute.get("/:id", jwt, getInvoiceById);
invoiceRoute.patch("/:id", jwt, writers, updateInvoice);
invoiceRoute.post("/:id/raise", jwt, writers, raiseInvoice);
invoiceRoute.post("/:id/mark-paid", jwt, writers, markPaid);
invoiceRoute.post("/:id/mark-unpaid", jwt, writers, markUnpaid);
invoiceRoute.post("/:id/resend-email", jwt, writers, resendInvoiceEmail);
invoiceRoute.delete("/:id", jwt, writers, deleteInvoice);

export { invoiceRoute };
