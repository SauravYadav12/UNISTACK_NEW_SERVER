import { Request, Response } from "express";
import { OrganizationModel } from "../models/organizationModel";
import { paginationInstance } from "../utils/pagination";
import { getErrorMessage, sequenceId } from "../utils/utils";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";

// First 3 uppercase alpha chars from the name. Admin can override to anything
// 2–5 chars via the explicit `shortCode` field on create/update.
// Fallback: "ORG" if the name has no alpha chars.
function suggestShortCode(name: string): string {
  const letters = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length === 0) return "ORG";
  if (letters.length === 1) return letters.padEnd(2, letters); // satisfy min 2
  return letters.slice(0, 3);
}

export const getAllOrganizations = async (req: Request, res: Response) => {
  try {
    const iQuery = handleSearchString(req.query, searchableFields.organization);
    const { options, instance } = await paginationInstance(iQuery, OrganizationModel);
    const { startIndex, query, limit } = options;
    const results = await OrganizationModel.find(query)
      .sort({ name: 1 })
      .limit(limit)
      .skip(startIndex)
      .exec();

    res.status(200).json({
      status: "success",
      data: { ...instance, results },
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const getOrganizationById = async (req: Request, res: Response) => {
  try {
    const org = await OrganizationModel.findById(req.params.id);
    if (!org) {
      res.status(404).json({ status: "failed", message: "Organization not found" });
      return;
    }
    res.status(200).json({ status: "success", data: org });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const createOrganization = async (req: Request, res: Response) => {
  try {
    const { name, shortCode, email, phone, website, address, einNumber } =
      req.body as Partial<{
        name: string;
        shortCode: string;
        email: string;
        phone: string;
        website: string;
        address: string;
        einNumber: string;
      }>;

    if (!name || !name.trim()) {
      res.status(400).json({ status: "failed", message: "name is required" });
      return;
    }

    const resolvedShort = (shortCode || suggestShortCode(name))
      .toUpperCase()
      .slice(0, 5);

    // Enforce shortCode uniqueness early with a clean 409 rather than a raw
    // duplicate-key error.
    const collision = await OrganizationModel.findOne({ shortCode: resolvedShort });
    if (collision) {
      res.status(409).json({
        status: "failed",
        message: `shortCode "${resolvedShort}" is already in use`,
      });
      return;
    }

    const orgId = await sequenceId(OrganizationModel, "orgId", "ORG");
    const user = req.user as
      | { firstName?: string; lastName?: string; email?: string }
      | undefined;
    const createdBy = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
      : undefined;

    const org = await OrganizationModel.create({
      orgId,
      name: name.trim(),
      shortCode: resolvedShort,
      email,
      phone,
      website,
      address,
      einNumber,
      active: true,
      createdBy,
    });
    res.status(200).json({ status: "success", data: org });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const updateOrganization = async (req: Request, res: Response) => {
  try {
    const body = { ...(req.body as Record<string, unknown>) };
    // Never let orgId be rewritten — it's the stable public ID.
    delete body.orgId;

    // ShortCode collision check (if being changed).
    if (typeof body.shortCode === "string") {
      const next = body.shortCode.toUpperCase().slice(0, 5);
      const clash = await OrganizationModel.findOne({
        shortCode: next,
        _id: { $ne: String(req.params.id) },
      });
      if (clash) {
        res.status(409).json({
          status: "failed",
          message: `shortCode "${next}" is already in use`,
        });
        return;
      }
      body.shortCode = next;
    }

    const org = await OrganizationModel.findByIdAndUpdate(req.params.id, body, {
      new: true,
    });
    if (!org) {
      res.status(404).json({ status: "failed", message: "Organization not found" });
      return;
    }
    res.status(200).json({ status: "success", data: org });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const archiveOrganization = async (req: Request, res: Response) => {
  const org = await OrganizationModel.findByIdAndUpdate(
    req.params.id,
    { active: false },
    { new: true }
  );
  if (!org) {
    res.status(404).json({ status: "failed", message: "Organization not found" });
    return;
  }
  res.status(200).json({ status: "success", data: org });
};

export const activateOrganization = async (req: Request, res: Response) => {
  const org = await OrganizationModel.findByIdAndUpdate(
    req.params.id,
    { active: true },
    { new: true }
  );
  if (!org) {
    res.status(404).json({ status: "failed", message: "Organization not found" });
    return;
  }
  res.status(200).json({ status: "success", data: org });
};
