import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  activateOrganization,
  archiveOrganization,
  createOrganization,
  getAllOrganizations,
  getOrganizationById,
  updateOrganization,
} from "../controllers/organizationController";

const organizationRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
// Org mutations are intentionally tighter than the rest of the project
// surface — project-coordinators can use orgs but not create/edit them.
const writers = anyRoleGuard(UserRole.SuperAdmin, UserRole.Admin);

organizationRoute.get("/get-organizations", jwt, getAllOrganizations);
organizationRoute.get("/get-organization/:id", jwt, getOrganizationById);
organizationRoute.post("/create-organization", jwt, writers, createOrganization);
organizationRoute.patch("/update-organization/:id", jwt, writers, updateOrganization);
organizationRoute.post("/:id/archive", jwt, writers, archiveOrganization);
organizationRoute.post("/:id/activate", jwt, writers, activateOrganization);

export { organizationRoute };
