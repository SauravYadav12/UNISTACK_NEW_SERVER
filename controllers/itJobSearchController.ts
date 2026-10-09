import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { SourcedJobModel, SourcedJobDoc } from "../models/sourcedJobModel";
import { RequirementModel } from "../models/requirementModel";
import { nextParentReqID } from "./requirementController";
import { UserDoc } from "../models/userModel";
import { ingestJobEmails } from "../services/emailJobIngestService";
import { ingestJsearchJobs } from "../services/jsearchIngestService";
import { ingestFeedJobs } from "../services/feedIngestService";
import { startBackgroundRun } from "../utils/backgroundRun";

// The requirement-shaped fields a reviewer may edit and that get copied
// into the Requirement on approval. Pipeline/classification metadata and
// status are NOT editable through here.
const REQUIREMENT_COPY_FIELDS = [
  "jobTitle",
  "jobDescription",
  "employementType",
  "jobPortalLink",
  "reqKeywords",
  "recordOwner",
  "primaryTech",
  "secondaryTech",
  "primaryTechStack",
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
  "remote",
  "duration",
] as const;

// GET /it-job-search?status=&source=&hasVendorContact=&q=&page=&limit=
export const listSourcedJobs = async (req: Request, res: Response) => {
  try {
    const {
      status = "pending",
      source,
      hasVendorContact,
      q,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const filter: FilterQuery<SourcedJobDoc> = {};
    if (status && status !== "all") filter.status = status as never;
    if (source) filter.source = source as never;
    if (hasVendorContact === "true") filter.hasVendorContact = true;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { jobTitle: rx },
        { clientCompany: rx },
        { vendorCompany: rx },
        { primaryTech: rx },
      ] as never;
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg = Math.max(parseInt(page, 10) || 1, 1);

    const [results, total] = await Promise.all([
      SourcedJobModel.find(filter)
        .sort({ receivedAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      SourcedJobModel.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      data: { results, total, page: pg, limit: lim },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// GET /it-job-search/:id
export const getSourcedJob = async (req: Request, res: Response) => {
  try {
    const doc = await SourcedJobModel.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// PATCH /it-job-search/:id  — edit the requirement-shaped fields pre-approval.
export const updateSourcedJob = async (req: Request, res: Response) => {
  try {
    const patch: Record<string, unknown> = {};
    for (const key of REQUIREMENT_COPY_FIELDS) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const doc = await SourcedJobModel.findOneAndUpdate(
      { _id: req.params.id as string, status: "pending" },
      { $set: patch },
      { new: true }
    );
    if (!doc) {
      res.status(404).json({
        status: "failed",
        message: "Not found or already reviewed",
      });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /it-job-search/:id/approve  → creates a Requirement.
export const approveSourcedJob = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const job = await SourcedJobModel.findById(req.params.id);
    if (!job) {
      res.status(404).json({ status: "failed", message: "Not found" });
      return;
    }
    if (job.status !== "pending") {
      res.status(409).json({
        status: "failed",
        message: `Already ${job.status}`,
      });
      return;
    }

    // Build the Requirement payload from the (possibly edited) job fields.
    const payload: Record<string, unknown> = {
      reqEnteredByRef: me._id,
      reqEnteredBy: `${me.firstName || ""} ${me.lastName || ""}`.trim() || me.email,
      reqStatus: "New Working",
      gotReqFrom: job.sourceName || "IT Job Search",
    };
    for (const key of REQUIREMENT_COPY_FIELDS) {
      const v = (job as unknown as Record<string, unknown>)[key];
      if (v !== undefined && v !== null && v !== "") payload[key] = v;
    }

    // Create the Requirement, retrying on the rare reqID race (same guard
    // the normal create endpoint uses).
    let created;
    let attempt = 0;
    while (attempt < 5) {
      payload.reqID = await nextParentReqID();
      try {
        created = await RequirementModel.create(payload);
        break;
      } catch (err: unknown) {
        const e = err as { code?: number; keyPattern?: Record<string, unknown> };
        if (e?.code === 11000 && e?.keyPattern && "reqID" in e.keyPattern) {
          attempt++;
          continue;
        }
        throw err;
      }
    }
    if (!created) {
      res.status(500).json({
        status: "failed",
        message: "Could not allocate a unique reqID. Please retry.",
      });
      return;
    }

    job.status = "approved";
    job.reviewedByRef = me._id as never;
    job.reviewedAt = new Date();
    job.createdRequirementRef = created._id as never;
    await job.save();

    res.status(200).json({
      status: "success",
      data: { requirement: created, sourcedJob: job },
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// POST /it-job-search/:id/reject
export const rejectSourcedJob = async (req: Request, res: Response) => {
  try {
    const me = req.user as UserDoc;
    const doc = await SourcedJobModel.findOneAndUpdate(
      { _id: req.params.id as string, status: "pending" },
      {
        $set: {
          status: "rejected",
          reviewedByRef: me._id,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!doc) {
      res.status(404).json({
        status: "failed",
        message: "Not found or already reviewed",
      });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(500).json({ status: "failed", error: String(error) });
  }
};

// The ingests can take tens of seconds, so every trigger is non-blocking:
// kick the work off in the background and return immediately. The client
// auto-refreshes the queue, so results appear as they land. An in-memory
// guard stops overlapping runs of the same kind.

// POST /it-job-search/ingest/run  — manual email catch-up (inbox is also
// watched in real time via IMAP IDLE, so this is just a fallback).
export const runEmailIngest = async (_req: Request, res: Response) => {
  const data = startBackgroundRun("email-ingest", ingestJobEmails);
  res.status(202).json({ status: "success", data });
};

// POST /it-job-search/ingest/jsearch  — manual trigger of the board sweep.
export const runJsearchIngest = async (_req: Request, res: Response) => {
  const data = startBackgroundRun("jsearch-ingest", ingestJsearchJobs);
  res.status(202).json({ status: "success", data });
};

// POST /it-job-search/ingest/feeds  — manual trigger of the free-feed pull.
export const runFeedIngest = async (_req: Request, res: Response) => {
  const data = startBackgroundRun("feed-ingest", ingestFeedJobs);
  res.status(202).json({ status: "success", data });
};
