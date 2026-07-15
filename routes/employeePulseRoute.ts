import express from "express";
import passport from "passport";
import {
  getEmployeePulse,
  listPulseEmployees,
} from "../controllers/employeePulseController";

/**
 * All Employee Pulse endpoints require a valid JWT. Fine-grained
 * gating (SuperAdmin default; other roles granted via Access Control)
 * happens on the client — the server accepts any authenticated read
 * because the sensitive data is already scoped by explicit userIds in
 * the request.
 */
const employeePulseRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });

employeePulseRoute.get("/", jwt, getEmployeePulse);
employeePulseRoute.get("/employees", jwt, listPulseEmployees);

export { employeePulseRoute };
