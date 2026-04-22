import express from "express";
import passport from "passport";
import { anyRoleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getAllProjects,
  getProjectById,
  createProjectFromRequirement,
  suggestProjectId,
  updateProject,
  deleteProject,
  addAdditionalDetail,
  updateAdditionalDetail,
  removeAdditionalDetail,
  addContract,
  removeContract,
} from "../controllers/projectController";
import { patchProjectDocumentation } from "../controllers/projectDocumentationController";

const projectRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const writers = anyRoleGuard(
  UserRole.SuperAdmin,
  UserRole.Admin,
  UserRole.ProjectCoordinator
);

projectRoute.get("/get-projects", jwt, getAllProjects);
projectRoute.get("/suggest-project-id", jwt, writers, suggestProjectId);
projectRoute.get("/get-project/:id", jwt, getProjectById);
projectRoute.post("/create-project", jwt, writers, createProjectFromRequirement);
projectRoute.patch("/update-project/:id", jwt, writers, updateProject);
projectRoute.delete("/delete-project/:id", jwt, writers, deleteProject);

projectRoute.post("/:id/additional-details", jwt, writers, addAdditionalDetail);
projectRoute.patch(
  "/:id/additional-details/:detailId",
  jwt,
  writers,
  updateAdditionalDetail
);
projectRoute.delete(
  "/:id/additional-details/:detailId",
  jwt,
  writers,
  removeAdditionalDetail
);

projectRoute.post("/:id/contracts", jwt, writers, addContract);
projectRoute.delete("/:id/contracts/:contractId", jwt, writers, removeContract);

projectRoute.patch(
  "/:id/documentation",
  jwt,
  writers,
  patchProjectDocumentation
);

export { projectRoute };
