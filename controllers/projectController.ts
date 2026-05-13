import { Request, Response } from "express";
import { Types, UpdateQuery } from "mongoose";
import { ProjectModel, ProjectDoc } from "../models/projectModel";
import { RequirementModel } from "../models/requirementModel";
import { OrganizationModel } from "../models/organizationModel";
import { UserModel, UserDoc } from "../models/userModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage, sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import { emitNotification } from "../services/notificationService";
import { UserRole } from "../enums/UserEnum";

// Fields copied verbatim from Requirement → Project at creation time.
// After this snapshot, later edits to the Requirement do NOT mutate the
// Project — by design, so a project's terms stay immutable once it starts.
const SEED_FIELDS = [
  "jobTitle",
  "clientCompany",
  "clientWebsite",
  "clientAddress",
  "clientPerson",
  "clientPhone",
  "clientEmail",
  "primeVendorCompany",
  "primeVendorWebsite",
  "primeVendorName",
  "primeVendorPhone",
  "primeVendorEmail",
  "vendorCompany",
  "vendorWebsite",
  "vendorPersonName",
  "vendorPhone",
  "vendorEmail",
  "rate",
  "taxType",
  "duration",
] as const;

export const getAllProjects = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.project);
    const { options, instance } = await paginationInstance(iQuery, ProjectModel);
    const { startIndex, query, limit } = options;
    const projects = await ProjectModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    res.status(200).json({
      status: "success",
      data: { ...instance, results: projects },
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const project = await ProjectModel.findById(req.params.id);
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Create a Project from an existing Requirement. Enforces 1-to-1:
 *  - the req must exist
 *  - no existing project may reference the same reqID
 * On success, also flips the source Requirement's reqStatus to
 * `Project Active` so the marketing grid reflects the transition.
 */
/**
 * Compute the next auto-incremented project ID — exposed as its own endpoint
 * so the AddProjectDialog can pre-fill the input and still let the admin
 * override. Format: PROJ-NN.
 */
export const suggestProjectId = async (_req: Request, res: Response) => {
  try {
    const id = await sequenceId(ProjectModel, "projectId", "PROJ");
    res.status(200).json({ status: "success", data: { projectId: id } });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const createProjectFromRequirement = async (
  req: Request,
  res: Response
) => {
  try {
    const { reqID, organizationId, projectId: providedId } = req.body as {
      reqID?: string;
      organizationId?: string;
      projectId?: string;
    };
    if (!reqID) {
      res.status(400).json({ status: "failed", message: "reqID is required" });
      return;
    }
    if (!organizationId) {
      res
        .status(400)
        .json({ status: "failed", message: "organizationId is required" });
      return;
    }

    // Optional admin-provided project ID — validate + collision-check upfront
    // so the client can display an inline "already exists" error without
    // going through a create attempt that partially succeeds.
    const projectIdTrimmed = providedId?.trim();
    if (projectIdTrimmed) {
      if (!/^[A-Za-z0-9-]{3,20}$/.test(projectIdTrimmed)) {
        res.status(400).json({
          status: "failed",
          message: "Project ID must be 3–20 alphanumerics or hyphens",
        });
        return;
      }
      const clash = await ProjectModel.findOne({
        projectId: projectIdTrimmed,
      });
      if (clash) {
        res.status(409).json({
          status: "failed",
          message: `Project ID "${projectIdTrimmed}" already exists`,
          code: "PROJECT_ID_TAKEN",
        });
        return;
      }
    }

    const organization = await OrganizationModel.findById(organizationId);
    if (!organization || !organization.active) {
      res.status(400).json({
        status: "failed",
        message: "Organization not found or not active",
      });
      return;
    }

    // One project per reqID, across ALL organizations. If the req is already
    // attached to a project (even one belonging to a different org), block
    // the create until an admin deletes/removes that existing project.
    const existing = await ProjectModel.findOne({ reqID }).populate(
      "organizationRef",
      "shortCode name",
    );
    if (existing) {
      const existingOrg = existing.organizationRef as
        | { shortCode?: string; name?: string }
        | undefined;
      const orgLabel = existingOrg?.shortCode || existingOrg?.name || "another organization";
      res.status(409).json({
        status: "failed",
        code: "REQ_ALREADY_PROJECT",
        message: `${reqID} is already attached as project ${existing.projectId} under ${orgLabel}. Delete that project first to re-attach this requirement elsewhere.`,
      });
      return;
    }

    const requirement = await RequirementModel.findOne({ reqID });
    if (!requirement) {
      res.status(404).json({
        status: "failed",
        message: `Requirement ${reqID} not found`,
      });
      return;
    }

    // Only **child** requirements (those with a `parentReqID`) can become
    // projects. Two states are explicitly rejected:
    //   - parent with live marketer assignments → no single engagement, the
    //     child is the unit of truth
    //   - legacy standalone or parent with no children → not yet a concrete
    //     marketer engagement; admin must assign a marketer first (spawns
    //     REQ-N-A), then convert that child
    if (!requirement.parentReqID) {
      const hasChildren = await RequirementModel.exists({
        parentReqID: requirement.reqID,
      });
      if (hasChildren) {
        res.status(400).json({
          status: "failed",
          code: "REQ_IS_PARENT_WITH_CHILDREN",
          message: `${reqID} has marketer assignments. Create the project from the specific marketer's assignment (e.g. ${reqID}-A).`,
        });
        return;
      }
      res.status(400).json({
        status: "failed",
        code: "REQ_NOT_CHILD",
        message: `${reqID} isn't a marketer assignment. Assign a marketer to it first (spawns ${reqID}-A) and create the project from that child.`,
      });
      return;
    }

    const snapshot: Record<string, unknown> = {};
    for (const f of SEED_FIELDS) {
      const val = (requirement as unknown as Record<string, unknown>)[f];
      if (val !== undefined) snapshot[f] = val;
    }

    // `consultant` on the requirement is tracked as `appliedFor` (consultant
    // the req was applied for). Carry that across — it's the most useful
    // display name for the project row.
    snapshot.consultant = requirement.appliedFor;

    const projectId =
      projectIdTrimmed || (await sequenceId(ProjectModel, "projectId", "PROJ"));
    const createdBy =
      (req.user as { firstName?: string; lastName?: string; email?: string } | undefined) &&
      `${(req.user as { firstName?: string }).firstName || ""} ${(req.user as { lastName?: string }).lastName || ""}`.trim();

    const project = await ProjectModel.create({
      projectId,
      reqID,
      requirementRef: requirement._id,
      organizationRef: organization._id,
      organizationName: organization.name,
      organizationShortCode: organization.shortCode,
      organizationEIN: organization.einNumber,
      organizationLogoUrl: organization.logoUrl,
      organizationAddress: organization.address,
      organizationEmail: organization.email,
      organizationWebsite: organization.website,
      ...snapshot,
      status: "Active",
      createdBy: createdBy || undefined,
    });

    // PROJECT_CREATED — notify the marketer who owned the requirement, the
    // support person who entered it, and every super-admin. The actor
    // (whoever clicked Create Project) is auto-excluded by the service.
    {
      const actor = req.user as UserDoc | undefined;
      const superAdminIds = await UserModel.distinct("_id", {
        role: UserRole.SuperAdmin,
        active: true,
      });
      void emitNotification({
        recipients: [
          requirement.assignedToRef,
          requirement.reqEnteredByRef,
          ...superAdminIds,
        ] as Array<unknown> as Array<string>,
        type: "PROJECT_CREATED",
        title: `Project ${project.projectId} created`,
        body: `${actor?.firstName || "Someone"} converted ${reqID} (${
          requirement.jobTitle || project.consultant || "—"
        }) into project ${project.projectId}.`,
        link: { kind: "project", projectId: project.projectId },
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

    // Flip the requirement status. We don't hard-fail if this step errors —
    // the project is the source of truth from here on.
    try {
      await RequirementModel.findByIdAndUpdate(requirement._id, {
        reqStatus: "Project Active",
      });
    } catch (e) {
      console.warn("Project created but reqStatus flip failed:", e);
    }

    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    console.error("Error creating project:", error);
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Patch the project-owned fields. Rejects attempts to overwrite the frozen
 * requirement snapshot — those must go via Additional Details instead.
 */
export const updateProject = async (req: Request, res: Response) => {
  try {
    const FROZEN = new Set<string>([
      "projectId",
      "reqID",
      "requirementRef",
      "organizationRef",
      "organizationName",
      "organizationShortCode",
      "organizationEIN",
      "contracts",
      "additionalDetails",
      "documentation", // use the documentation PATCH endpoint instead
      ...SEED_FIELDS,
    ]);
    const body = { ...(req.body as Record<string, unknown>) };
    for (const k of Object.keys(body)) {
      if (FROZEN.has(k)) delete body[k];
    }

    // Capture the previous state so we can detect a real status transition
    // (and avoid emitting a notification when the admin just edits dates etc).
    const before = await ProjectModel.findById(req.params.id).lean();
    const updated = await ProjectModel.findByIdAndUpdate(
      req.params.id,
      body,
      { new: true }
    );
    if (!updated) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }

    // PROJECT_STATUS_CHANGED — only when the status actually moved. Recipients:
    // the requirement's marketer + support owner + super-admins so leadership
    // sees holds / terminations / endings as they happen.
    if (before && before.status !== updated.status) {
      const requirement = updated.reqID
        ? await RequirementModel.findOne({ reqID: updated.reqID })
            .select("assignedToRef reqEnteredByRef")
            .lean()
        : null;
      const superAdminIds = await UserModel.distinct("_id", {
        role: UserRole.SuperAdmin,
        active: true,
      });
      const actor = req.user as UserDoc | undefined;
      void emitNotification({
        recipients: [
          requirement?.assignedToRef,
          requirement?.reqEnteredByRef,
          ...superAdminIds,
        ] as Array<unknown> as Array<string>,
        type: "PROJECT_STATUS_CHANGED",
        title: `Project ${updated.projectId} → ${updated.status}`,
        body: `${actor?.firstName || "An admin"} moved ${updated.projectId} from ${before.status} to ${updated.status}.`,
        link: { kind: "project", projectId: updated.projectId },
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

    res.status(200).json({ status: "success", data: updated });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const removed = await ProjectModel.findByIdAndDelete(req.params.id);
    if (!removed) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({
      status: "success",
      message: "Project deleted successfully",
      data: removed,
    });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

// ── Additional details (key/value pairs) ──

export const addAdditionalDetail = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key || !key.trim()) {
      res.status(400).json({ status: "failed", message: "key is required" });
      return;
    }
    const addedBy = (req.user as { firstName?: string; lastName?: string } | undefined);
    const project = await ProjectModel.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          additionalDetails: {
            key: key.trim(),
            value: (value || "").trim(),
            addedBy:
              addedBy && `${addedBy.firstName || ""} ${addedBy.lastName || ""}`.trim(),
            addedAt: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const updateAdditionalDetail = async (req: Request, res: Response) => {
  try {
    const { id, detailId } = req.params;
    const { key, value } = req.body as { key?: string; value?: string };
    const set: Record<string, unknown> = {};
    if (key !== undefined) set["additionalDetails.$.key"] = key;
    if (value !== undefined) set["additionalDetails.$.value"] = value;
    if (!Object.keys(set).length) {
      res
        .status(400)
        .json({ status: "failed", message: "Nothing to update" });
      return;
    }
    const project = await ProjectModel.findOneAndUpdate(
      { _id: String(id), "additionalDetails._id": new Types.ObjectId(String(detailId)) },
      { $set: set },
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Detail not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const removeAdditionalDetail = async (req: Request, res: Response) => {
  try {
    const { id, detailId } = req.params;
    const update = {
      $pull: {
        additionalDetails: { _id: new Types.ObjectId(String(detailId)) },
      },
    } as unknown as UpdateQuery<ProjectDoc>;
    const project = await ProjectModel.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

// ── Contracts ──

export const addContract = async (req: Request, res: Response) => {
  try {
    const { scope, url, fileName, sizeBytes, label } = req.body as {
      scope?: string;
      url?: string;
      fileName?: string;
      sizeBytes?: number;
      label?: string;
    };
    const allowed = ["client", "vendor", "primeVendor", "other"];
    if (!scope || !allowed.includes(scope)) {
      res
        .status(400)
        .json({ status: "failed", message: "Invalid contract scope" });
      return;
    }
    if (!url || !fileName) {
      res
        .status(400)
        .json({ status: "failed", message: "url and fileName are required" });
      return;
    }
    const uploader = (req.user as { firstName?: string; lastName?: string } | undefined);
    const project = await ProjectModel.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          contracts: {
            scope,
            url,
            fileName,
            sizeBytes,
            label,
            uploadedBy:
              uploader && `${uploader.firstName || ""} ${uploader.lastName || ""}`.trim(),
            uploadedAt: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const removeContract = async (req: Request, res: Response) => {
  try {
    const { id, contractId } = req.params;
    const update = {
      $pull: {
        contracts: { _id: new Types.ObjectId(String(contractId)) },
      },
    } as unknown as UpdateQuery<ProjectDoc>;
    const project = await ProjectModel.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );
    if (!project) {
      res.status(404).json({ status: "failed", message: "Project not found" });
      return;
    }
    res.status(200).json({ status: "success", data: project });
  } catch (error) {
    res
      .status(400)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};
