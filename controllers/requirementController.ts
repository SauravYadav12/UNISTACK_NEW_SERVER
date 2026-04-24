import { Request, Response } from "express";
import { updateArrayFields } from "../utils/arrayUpdateOprations";
import { paginationInstance } from "../utils/pagination";
import {
  handleSearchString,
  searchableFields,
} from "../utils/searchStringOperation";
import {
  getErrorMessage,
  handleDateQuery,
  handlePaginationQuery,
  sequenceId,
} from "../utils/utils";
import { RequirementModel } from "../models/requirementModel";
import { InterviewModel } from "../models/interviewModel";
import { ProjectModel } from "../models/projectModel";
import RequirementLogModel from "../models/requirement.log.model";
import { ArchiveRequirement } from "../db/archiveInstance";
import {
  extractRequirementFromContent,
  RequirementExtractionValidationError,
} from "../services/requirementExtractionService";
import {
  buildChildReqID,
  nextChildSuffix,
  suffixToIndex,
} from "../utils/childReqId";

export const extractRequirementData = async (req: Request, res: Response) => {
  try {
    const { content, instruction } = req.body as {
      content?: unknown;
      instruction?: unknown;
    };

    const data = await extractRequirementFromContent({
      content: typeof content === "string" ? content : "",
      instruction:
        instruction === undefined || instruction === null
          ? undefined
          : String(instruction),
    });

    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    if (error instanceof RequirementExtractionValidationError) {
      res.status(400).json({
        status: "failed",
        error: error.message,
        details: error.details,
      });
      return;
    }
    console.error("Error extracting requirement:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const getAllRrequirements = async (req: Request, res: Response) => {
  try {
    // Caller can opt in to seeing child assignments inline
    // (e.g. grid expansion fetches children by parentReqID=REQ-05).
    const { includeChildren, parentReqID, ...rest } = req.query as Record<
      string,
      unknown
    >;
    const fetchingChildren = typeof parentReqID === "string" && parentReqID.length > 0;

    // An explicit reqID lookup is an exact-match pull — the caller already
    // knows which document they want (typically a drawer/detail pane). The
    // parent-hiding branch below was designed to keep the grid honest
    // under status/owner filters; it must NOT clobber a direct lookup of
    // a parent-with-children, which is exactly what the "Edit on parent"
    // button does. Used as an opt-out below.
    const isExplicitReqIDLookup =
      typeof rest.reqID === "string" && (rest.reqID as string).length > 0;

    // When the user applies any non-pagination filter (searching for a
    // reqID, assignee, status, etc.), include children so their result
    // appears. The default unfiltered list keeps children tucked under
    // their parents for the expand/collapse grid.
    const nonPaginationFilterKeys = Object.keys(rest).filter((k) => {
      if (["page", "limit", "sort", "archive"].includes(k)) return false;
      const v = rest[k];
      return v !== undefined && v !== null && v !== "";
    });
    const includeAll =
      fetchingChildren ||
      includeChildren === "true" ||
      includeChildren === "1" ||
      nonPaginationFilterKeys.length > 0;

    const iQuery = handleSearchString(rest, searchableFields.requirement);
    const { options, instance } = await paginationInstance(
      iQuery,
      RequirementModel,
    );
    const { startIndex, limit, query } = options;

    // Top-level grid shows parents + legacy standalone rows only. Children
    // are fetched separately when a user expands a parent row.
    const finalQuery: Record<string, unknown> = { ...query };
    if (fetchingChildren) {
      finalQuery.parentReqID = parentReqID;
    } else if (!includeAll) {
      finalQuery.$or = [
        { parentReqID: { $exists: false } },
        { parentReqID: null },
        { parentReqID: "" },
      ];
    }

    // When any filter is applied (reqStatus / assignedToRef / …), a parent
    // that has children would match misleadingly on its own stale fields
    // (e.g. its reqStatus stays "New Working" forever, while the real work
    // happens on children). Exclude those parents so the user only ever
    // sees children and legacy standalone rows in filtered views.
    //
    // Exempt explicit reqID lookups (`?reqID=REQ-04`): those are exact-match
    // pulls from a drawer/detail pane that must be able to load a parent
    // even when that parent has children — otherwise the "Edit on parent"
    // button shows a blank drawer.
    if (!fetchingChildren && includeAll && !isExplicitReqIDLookup) {
      const parentIdsWithChildren = (await RequirementModel.distinct(
        "parentReqID",
        { parentReqID: { $exists: true, $ne: "" } }
      )) as string[];
      if (parentIdsWithChildren.length > 0) {
        const existingAnd = (finalQuery.$and as unknown[] | undefined) || [];
        finalQuery.$and = [
          ...existingAnd,
          {
            $or: [
              // keep any child assignment
              { parentReqID: { $exists: true, $nin: [null, ""] } },
              // keep parents that have NO children (legacy standalone,
              // or new parents not yet assigned)
              { reqID: { $nin: parentIdsWithChildren } },
            ],
          },
        ];
      }
    }

    // Recompute totalDocuments against the fully augmented query so the
    // paginator reflects what the user actually sees. `paginationInstance`
    // already ran countDocuments against `iQuery` (before parent-exclusion
    // adjustments), so without this patch the pagination footer would
    // disagree with the visible rows.
    const totalDocuments = await RequirementModel.countDocuments(finalQuery);
    const instanceWithAccurateCount = { ...instance, totalDocuments };

    const requirements = await RequirementModel.find(finalQuery)
      .sort(fetchingChildren ? { childSuffix: 1 } : { createdAt: -1 })
      .limit(fetchingChildren ? 0 : limit)
      .skip(fetchingChildren ? 0 : startIndex)
      .exec();
    const data = { ...instanceWithAccurateCount, results: requirements };
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    console.error("Error fetching requirements:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

/**
 * Compute the next parent reqID (`REQ-NN`) by scanning EVERY existing reqID —
 * parents, children (`REQ-08-A`), legacy standalones — and taking the max of
 * the top numeric component, then +1.
 *
 * The generic `sequenceId` util picks the most-recently-created doc and
 * parses its id; that's broken here because a freshly-spawned child like
 * `REQ-03-B` has a newer `createdAt` than all parents but a lower top
 * number, so the util would hand back `REQ-04` — which already exists.
 */
async function nextParentReqID(): Promise<string> {
  const rows = await RequirementModel.find({}, { reqID: 1 }).lean();
  let max = 0;
  for (const r of rows) {
    const id = r.reqID;
    if (typeof id !== "string") continue;
    // Match "REQ-<digits>" optionally followed by "-<suffix>"
    const m = id.match(/^REQ-(\d+)(?:-.*)?$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  const padded = next < 10 ? `0${next}` : String(next);
  return `REQ-${padded}`;
}

export const createRequirement = async (req: Request, res: Response) => {
  try {
    // Retry loop in case two admins race the create — the unique index on
    // reqID will reject one; we re-compute and try again. Small bounded
    // retries keep the error path responsive.
    let attempt = 0;
    while (attempt < 5) {
      req.body.reqID = await nextParentReqID();
      try {
        const data = await RequirementModel.create(req.body);
        res.status(200).json({
          status: "success",
          data,
        });
        return;
      } catch (err: unknown) {
        const e = err as { code?: number; keyPattern?: Record<string, unknown> };
        const isDupReqID =
          e?.code === 11000 && e?.keyPattern && "reqID" in e.keyPattern;
        if (!isDupReqID) throw err;
        attempt++;
      }
    }
    // If we couldn't settle on a free reqID after 5 tries there's something
    // genuinely wrong — surface it rather than looping forever.
    res.status(500).json({
      status: "failed",
      message: "Could not allocate a unique reqID. Please retry.",
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

export const updateRequirement = async (req: Request, res: Response) => {
  try {
    const arrayFields = ["mComment"];

    const updateOps = updateArrayFields(req, arrayFields);

    const nonArrayUpdates = { ...req.body };

    const updatedReq = await RequirementModel.findByIdAndUpdate(
      req.params.id,
      { ...nonArrayUpdates, ...updateOps },
      { new: true },
    );

    res.status(200).json({
      status: "success",
      data: updatedReq,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const deleteRequirement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Look up first so we can check for child assignments before deleting.
    // Cascade-delete would orphan interview records keyed by child reqID;
    // instead we block the delete and point the operator at the Assign
    // drawer, which already enforces the "no pending interviews" guard.
    const target = await RequirementModel.findById(id);
    if (!target) {
      res.status(404).json({
        status: "failed",
        message: "RequirementModel not found",
      });
      return;
    }
    if (!target.parentReqID && target.reqID) {
      const childCount = await RequirementModel.countDocuments({
        parentReqID: target.reqID,
      });
      if (childCount > 0) {
        res.status(400).json({
          status: "failed",
          message: `This requirement has ${childCount} marketer assignment${childCount === 1 ? "" : "s"}. Remove the assignment${childCount === 1 ? "" : "s"} before deleting.`,
        });
        return;
      }
    }

    const deletedRequirement = await RequirementModel.findByIdAndDelete(id);
    res.status(200).json({
      status: "success",
      message: "RequirementModel deleted successfully",
      deletedRequirement,
    });
  } catch (error) {
    console.error("Error deleting requirement:", error);
    res.status(500).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const getRequirementLog = async (req: Request, res: Response) => {
  try {
    // Special mode: aggregate parent + all children's logs for the parent
    // drawer's log table. Resolves reqID → doc _id(s) first, then searches
    // the log collection by `requirementRef $in`. Falls through to the
    // normal date/ref filter when `parentReqID` isn't provided.
    const parentReqID =
      typeof req.query.parentReqID === "string"
        ? req.query.parentReqID.trim()
        : "";

    if (parentReqID) {
      const docs = await RequirementModel.find({
        $or: [{ reqID: parentReqID }, { parentReqID }],
      })
        .select("_id")
        .lean();
      const ids = docs.map((d) => d._id);
      if (ids.length === 0) {
        res.status(200).json({ status: "success", data: [] });
        return;
      }
      const data = await RequirementLogModel.find({
        requirementRef: { $in: ids },
      }).sort({ createdAt: -1 });
      res.status(200).json({ status: "success", data });
      return;
    }

    const q = handleDateQuery(req.query);
    const data = await RequirementLogModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

export const createRequirementLog = async (req: Request, res: Response) => {
  try {
    const data = await RequirementLogModel.create(req.body);
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const requirementsCounts = async (req: Request, res: Response) => {
  try {
    const {
      date,
      timezone = "Asia/Kolkata",
      archive = false,
      ...filters
    } = req.query;
    let iDates = date;
    const { query } = handlePaginationQuery(filters);

    if (!iDates) {
      res.status(400).json({
        status: "failed",
        message: "Date query is required",
      });
      return;
    }

    if (typeof timezone !== "string") {
      res.status(400).json({
        status: "failed",
        message: "Timezone must be a string",
      });
      return;
    }

    if (!Array.isArray(iDates)) {
      if (typeof iDates === "string") {
        iDates = [iDates];
      } else if (typeof iDates === "object") {
        iDates = Object.values(iDates).filter((d) => typeof d === "string");
      }
    }

    iDates = iDates?.filter((d) => !!d);

    iDates.forEach((d) => {
      const dateString = d as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        res.status(400).json({
          status: "failed",
          message: `Date must be in YYYY-MM-DD format: ${dateString}`,
        });
        return;
      }

      const parsedDate = new Date(dateString);
      if (isNaN(parsedDate.getTime())) {
        res
          .status(400)
          .json({ status: "failed", message: `Invalid date: ${dateString}` });
        return;
      }
    });

    const dateObjects = iDates.map((d) => new Date(d as string));
    const minInputDate = new Date(
      Math.min(...dateObjects.map((d) => d.getTime())),
    );
    const maxInputDate = new Date(
      Math.max(...dateObjects.map((d) => d.getTime())),
    );

    const minDate = new Date(minInputDate.getTime() - 24 * 60 * 60 * 1000);
    const maxDate = new Date(maxInputDate.getTime() + 24 * 60 * 60 * 1000);

    const aggregationResult = await (
      archive.toString().toLowerCase() === "true"
        ? ArchiveRequirement
        : RequirementModel
    ).aggregate([
      {
        $match: {
          ...query,
          // Count only parents + legacy standalone — child assignments
          // aren't independent requirements for dashboard/heatmap purposes.
          parentReqID: { $in: [null, ""] },
          createdAt: {
            $gte: minDate,
            $lte: maxDate,
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: timezone,
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          date: "$_id",
          count: 1,
          _id: 0,
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    const countMap = new Map();

    aggregationResult.forEach((item) => {
      countMap.set(item.date, item.count);
    });

    const counts = iDates.map((dateStr) => {
      const dateString = dateStr as string;
      return {
        date: dateString,
        count: countMap.get(dateString) || 0,
      };
    });

    res.status(200).json({
      status: "success",
      data: counts,
      timezone: timezone,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
      error: error,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-assign: spawn one child requirement per marketer.
// Fields that describe the job (client, JD, tech, rate, etc.) are cloned from
// the parent so each marketer's child renders a full record. Per-marketer
// scratch (mComment, resume) starts empty. The child keeps reqEnteredByRef
// from the parent so support scoring can still attribute credit to the
// original support person via roll-up.
// ─────────────────────────────────────────────────────────────────────────────

// Fields that belong to the parent (job description) — cloned onto children
// so each child renders a complete requirement card on its own.
const PARENT_OWNED_FIELDS: Array<keyof typeof RequirementModel.prototype> = [
  "appliedFor",
  "appliedForRef",
  "rate",
  "taxType",
  "remote",
  "duration",
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
  "reqEnteredDate",
  "gotReqFrom",
  "gotOnResume",
  "jobTitle",
  "employementType",
  "jobPortalLink",
  "reqEnteredBy",
  "reqEnteredByRef",
  "reqKeywords",
  "jobDescription",
  "recordOwner",
  "primaryTech",
  "secondaryTech",
  "primaryTechStack",
] as Array<never>;

export const assignMarketers = async (req: Request, res: Response) => {
  try {
    const reqID = String(req.params.reqID || "");
    const { assignments } = req.body as {
      assignments?: Array<{ marketerRef: string; marketerName?: string }>;
    };

    if (!reqID) {
      res.status(400).json({ status: "failed", message: "reqID is required" });
      return;
    }

    if (!Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({
        status: "failed",
        message: "assignments array is required",
      });
      return;
    }

    const parent = await RequirementModel.findOne({ reqID }).lean();
    if (!parent) {
      res.status(404).json({ status: "failed", message: "Parent requirement not found" });
      return;
    }
    if (parent.parentReqID) {
      res.status(400).json({
        status: "failed",
        message: "Cannot assign marketers on a child requirement",
      });
      return;
    }

    // Sequentially compute suffixes so two picks in the same request don't
    // collide. `nextChildSuffix` reads current state; after each create we
    // recompute.
    const created: Array<Record<string, unknown>> = [];
    for (const a of assignments) {
      if (!a || typeof a.marketerRef !== "string" || !a.marketerRef) continue;

      const suffix = await nextChildSuffix(parent.reqID);
      const cloned: Record<string, unknown> = {};
      for (const key of PARENT_OWNED_FIELDS) {
        const value = (parent as Record<string, unknown>)[key as string];
        if (value !== undefined) cloned[key as string] = value;
      }

      cloned.reqID = buildChildReqID(parent.reqID, suffix);
      cloned.parentReqID = parent.reqID;
      cloned.childSuffix = suffix;
      cloned.assignedToRef = a.marketerRef;
      cloned.assignedTo = a.marketerName || "";
      cloned.reqStatus = "New Working";
      cloned.mComment = [];
      cloned.resume = "";
      cloned.resumeUpload = "";

      const doc = await RequirementModel.create(cloned);
      created.push(doc.toObject());
    }

    res.status(200).json({
      status: "success",
      data: created,
    });
  } catch (error) {
    console.error("assignMarketers error:", error);
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
    });
  }
};

export const unassignMarketer = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const child = await RequirementModel.findById(id);
    if (!child) {
      res.status(404).json({ status: "failed", message: "Assignment not found" });
      return;
    }
    if (!child.parentReqID) {
      res.status(400).json({
        status: "failed",
        message: "Target is not a child assignment",
      });
      return;
    }

    // Guard: if this child has any interviews, refuse — operator must first
    // resolve/cancel the interviews so scoring attribution stays accurate.
    const interviewCount = await InterviewModel.countDocuments({ reqID: child.reqID });
    if (interviewCount > 0) {
      res.status(400).json({
        status: "failed",
        message: `Cannot remove assignment with ${interviewCount} interview(s). Resolve them first.`,
      });
      return;
    }

    await RequirementModel.findByIdAndDelete(id);
    res.status(200).json({ status: "success", message: "Assignment removed" });
  } catch (error) {
    console.error("unassignMarketer error:", error);
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Search endpoint used by the interview-creation picker. Accepts either a
 * parent reqID or a child reqID and always returns a uniform shape:
 * `{ parent, assignments[], isParent, matchedReqID? }`.
 * Legacy standalone reqs (no children) return an empty `assignments` array
 * plus a `legacySelf` flag so the picker can render a single-assignment row
 * synthesized from the parent's own `assignedToRef`.
 */
export const searchRequirementByReqID = async (req: Request, res: Response) => {
  try {
    const raw = req.params.reqID;
    if (!raw || typeof raw !== "string") {
      res.status(400).json({ status: "failed", message: "reqID is required" });
      return;
    }

    // Stored reqIDs are always upper-case (e.g. `REQ-08-A`). Normalize
    // whatever the admin typed so a lookup with `req-08-a` or `Req-08-a`
    // still resolves. Also strip surrounding whitespace paste-artifacts.
    const reqID = raw.trim().toUpperCase();

    const match = await RequirementModel.findOne({ reqID }).lean();
    if (!match) {
      res.status(404).json({ status: "failed", message: "No requirement found" });
      return;
    }

    let parent: Record<string, unknown>;
    let matchedReqID: string | undefined;
    if (match.parentReqID) {
      const parentDoc = await RequirementModel.findOne({ reqID: match.parentReqID }).lean();
      if (!parentDoc) {
        res.status(404).json({
          status: "failed",
          message: `Parent requirement ${match.parentReqID} missing`,
        });
        return;
      }
      parent = parentDoc as unknown as Record<string, unknown>;
      matchedReqID = match.reqID;
    } else {
      parent = match as unknown as Record<string, unknown>;
    }

    const parentReqID = parent.reqID as string;
    const assignments = await RequirementModel.find({ parentReqID })
      .sort({ childSuffix: 1 })
      .lean();

    // Pull existing projects for the parent + every child in ONE query so
    // the picker can render "already a project under ORG-X" inline and
    // downstream callers (e.g. AddProjectDialog) can disable Select on those
    // rows without extra roundtrips.
    const allReqIDs = [parentReqID, ...assignments.map((a) => a.reqID)];
    const projectRows = (await ProjectModel.find({
      reqID: { $in: allReqIDs },
    })
      .select("reqID projectId organizationRef")
      .populate("organizationRef", "shortCode name")
      .lean()) as Array<{
      reqID?: string;
      projectId?: string;
      organizationRef?: { shortCode?: string; name?: string };
    }>;
    const projectByReqID = new Map<
      string,
      {
        projectId?: string;
        organizationShortCode?: string;
        organizationName?: string;
      }
    >();
    for (const p of projectRows) {
      if (!p.reqID) continue;
      projectByReqID.set(p.reqID, {
        projectId: p.projectId,
        organizationShortCode: p.organizationRef?.shortCode,
        organizationName: p.organizationRef?.name,
      });
    }

    const assignmentsWithProject = assignments.map((a) => ({
      ...a,
      project: projectByReqID.get(a.reqID) || undefined,
    }));
    const parentWithProject = {
      ...parent,
      project: projectByReqID.get(parentReqID) || undefined,
    };

    res.status(200).json({
      status: "success",
      data: {
        parent: parentWithProject,
        assignments: assignmentsWithProject,
        isParent: !match.parentReqID,
        matchedReqID,
        legacySelf: assignments.length === 0,
      },
    });
  } catch (error) {
    console.error("searchRequirementByReqID error:", error);
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

// Unused import guard — referenced to keep tsc happy when assignments body
// is empty but suffixToIndex is imported for test hooks in other branches.
void suffixToIndex;
