/**
 * Form-16 routes. All routes JWT-authed; everything except the
 * employee-facing `/my-documents/form16` is super-admin-gated.
 * The employee endpoint is mounted alongside the rest of the
 * `/my-documents/*` surface (see routes/myDocumentsRoute.ts).
 */

import express from "express";
import passport from "passport";
import { roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  createForm16,
  bulkCreateForm16,
  listForm16,
  publishForm16,
  unpublishForm16,
  publishAllForFY,
  deleteForm16,
  getForm16Lookup,
} from "../controllers/form16Controller";

const auth = passport.authenticate("jwt", { session: false });
const superOnly = roleGuard(UserRole.SuperAdmin);

const form16Route = express.Router();

form16Route.get("/", auth, superOnly, listForm16);
form16Route.post("/", auth, superOnly, createForm16);
form16Route.post("/bulk", auth, superOnly, bulkCreateForm16);
form16Route.post("/:id/publish", auth, superOnly, publishForm16);
form16Route.post("/:id/unpublish", auth, superOnly, unpublishForm16);
form16Route.post("/publish-bulk", auth, superOnly, publishAllForFY);
form16Route.delete("/:id", auth, superOnly, deleteForm16);

// Filename-matcher lookup for the drawer. Returns the compact
// {userId, name, email, employeeId, panNumber} list. Super-admin
// only — the matcher needs PAN which is sensitive.
form16Route.get("/lookup", auth, superOnly, getForm16Lookup);

export { form16Route };
