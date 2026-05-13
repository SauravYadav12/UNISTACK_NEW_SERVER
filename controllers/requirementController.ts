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
import { IRequirement } from "../interface/modelInterfaces";
import { InterviewModel } from "../models/interviewModel";
import { ProjectModel } from "../models/projectModel";
import RequirementLogModel from "../models/requirement.log.model";
import { ArchiveRequirement } from "../db/archiveInstance";
import { emitNotification } from "../services/notificationService";
import { UserDoc } from "../models/userModel";
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
    const { includeChildren, parentReqID, onlyChildren, ...rest } =
      req.query as Record<string, unknown>;
    const fetchingChildren = typeof parentReqID === "string" && parentReqID.length > 0;
    // PipelineSnapshot's "All Assigned" tile uses this — count of every
    // child requirement irrespective of which parent they belong to.
    // Bypasses the default parent-only view and the parent-hiding filter,
    // so totalDocuments on the response is purely the number of children.
    const onlyChildrenMode =
      onlyChildren === "true" || onlyChildren === "1" || onlyChildren === true;

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
    if (onlyChildrenMode) {
      // Count-or-list every child requirement, regardless of parent.
      finalQuery.parentReqID = { $exists: true, $nin: [null, ""] };
    } else if (fetchingChildren) {
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
    if (
      !fetchingChildren &&
      !onlyChildrenMode &&
      includeAll &&
      !isExplicitReqIDLookup
    ) {
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

    // Enrich parent rows with `hasChildren` so the client grid can render
    // the expand chevron only when there's something to expand. Skipped
    // when fetching children (every row already IS a child) and when
    // there are no parent-shaped reqIDs in the result set. One distinct
    // query irrespective of result count.
    const parentReqIDs = fetchingChildren
      ? []
      : requirements
          .filter((r) => !r.parentReqID && r.reqID)
          .map((r) => r.reqID as string);
    let parentsWithChildrenSet = new Set<string>();
    if (parentReqIDs.length) {
      const distinctParents = (await RequirementModel.distinct("parentReqID", {
        parentReqID: { $in: parentReqIDs },
      })) as string[];
      parentsWithChildrenSet = new Set(distinctParents.filter(Boolean));
    }
    const enriched = requirements.map((r) => {
      const obj = r.toObject() as unknown as IRequirement & {
        hasChildren?: boolean;
      };
      if (!r.parentReqID && r.reqID && parentsWithChildrenSet.has(r.reqID)) {
        obj.hasChildren = true;
      }
      return obj;
    });

    const data = { ...instanceWithAccurateCount, results: enriched };
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

    // Capture the previous status so we can detect a transition to Submitted
    // and notify the support person who entered the requirement.
    const before = await RequirementModel.findById(req.params.id).lean();
    const updatedReq = await RequirementModel.findByIdAndUpdate(
      req.params.id,
      { ...nonArrayUpdates, ...updateOps },
      { new: true },
    );

    // Event 3 — manual status change to Submitted (the auto-sync path uses
    // syncRequirementStatus.ts which handles its own emit for events 4-5).
    if (
      updatedReq &&
      before &&
      before.reqStatus !== "Submitted" &&
      updatedReq.reqStatus === "Submitted" &&
      updatedReq.reqEnteredByRef
    ) {
      const actor = req.user as UserDoc | undefined;
      void emitNotification({
        recipients: [updatedReq.reqEnteredByRef],
        type: "REQUIREMENT_SUBMITTED",
        title: `Requirement ${updatedReq.reqID} submitted`,
        body: `${actor?.firstName || "Someone"} moved ${updatedReq.reqID} to Submitted.`,
        link: { kind: "requirement", reqID: updatedReq.reqID },
        actor: actor
          ? {
              _id: actor._id,
              name: `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || actor.email,
            }
          : undefined,
      });
    }

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
      // Pull the listing-shaped filters out so we can mirror the same
      // parent/child segmenting that `getAllRrequirements` applies. The
      // count must agree with what's visible in the grid for that date —
      // otherwise a "New Working" filter shows N rows but the date pill
      // says 00 because counts were always restricted to parents.
      onlyChildren,
      includeChildren,
      parentReqID,
      reqStatus,
      reqID: filterReqID,
      ...filters
    } = req.query;
    let iDates = date;
    // `handlePaginationQuery` only knows about the leftover filters, but
    // we need to also fold in `reqStatus` / `reqID` filters so the count
    // applies to the same documents that `getAllRrequirements` would
    // return for the same query string.
    const { query } = handlePaginationQuery({
      ...filters,
      ...(typeof reqStatus === "string" && reqStatus.length > 0
        ? { reqStatus }
        : {}),
      ...(typeof filterReqID === "string" && filterReqID.length > 0
        ? { reqID: filterReqID }
        : {}),
    });

    // Parent / child segmentation — mirror the same three-way branch from
    // `getAllRrequirements` so the count tracks the visible grid rows.
    const onlyChildrenMode =
      onlyChildren === "true" || onlyChildren === "1";
    const fetchingChildren =
      typeof parentReqID === "string" && (parentReqID as string).length > 0;
    const isExplicitReqIDLookup =
      typeof filterReqID === "string" && (filterReqID as string).length > 0;
    const nonPaginationFilterKeys = Object.keys(filters).filter((k) => {
      if (["page", "limit", "sort", "timezone", "archive"].includes(k))
        return false;
      const v = (filters as Record<string, unknown>)[k];
      return v !== undefined && v !== null && v !== "";
    });
    const includeAll =
      onlyChildrenMode ||
      fetchingChildren ||
      includeChildren === "true" ||
      includeChildren === "1" ||
      isExplicitReqIDLookup ||
      (typeof reqStatus === "string" && reqStatus.length > 0) ||
      nonPaginationFilterKeys.length > 0;

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

    // Build the parent/child match. Three branches that mirror the
    // listing endpoint exactly so the date-pill count agrees with the
    // number of rows the grid renders for that day under the same filter:
    //   (a) onlyChildren=true     → count just children
    //   (b) any filter applied    → count children + parents-WITHOUT-
    //                                children (skip parents-with-children
    //                                because their stale status would
    //                                mislead the per-day total)
    //   (c) unfiltered            → count parents + legacy standalones
    const matchStage: Record<string, unknown> = {
      ...query,
      createdAt: { $gte: minDate, $lte: maxDate },
    };
    if (onlyChildrenMode) {
      matchStage.parentReqID = { $exists: true, $nin: [null, ""] };
    } else if (!includeAll) {
      matchStage.parentReqID = { $in: [null, ""] };
    } else if (!isExplicitReqIDLookup && !fetchingChildren) {
      // Filtered view — exclude parents-with-children so they don't
      // double-count alongside their kids.
      const parentIdsWithChildren = (await RequirementModel.distinct(
        "parentReqID",
        { parentReqID: { $exists: true, $ne: "" } }
      )) as string[];
      if (parentIdsWithChildren.length > 0) {
        matchStage.$or = [
          { parentReqID: { $exists: true, $nin: [null, ""] } },
          { reqID: { $nin: parentIdsWithChildren } },
        ];
      }
    }

    const aggregationResult = await (
      archive.toString().toLowerCase() === "true"
        ? ArchiveRequirement
        : RequirementModel
    ).aggregate([
      {
        $match: matchStage,
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

/**
 * GET /requirements/pipeline-counts?archive=false
 *
 * Returns every count the PipelineSnapshot widget needs in a single MongoDB
 * `$facet` round-trip. Replaces ~10 separate `get-requirements?reqStatus=X
 * &page=1&limit=1` calls the client used to make per status tile — a 90%
 * reduction in calls per pipeline render, and a single DB round-trip
 * server-side regardless of how many statuses we add.
 *
 * Response shape:
 *   { all, allAssigned, byStatus: { "New Working": N, ... } }
 *
 *   - `all`          → top-level documents (parents + legacy standalones)
 *                       i.e. the same set the grid shows with no filter.
 *   - `allAssigned`  → child documents (per-marketer assignments).
 *   - `byStatus`     → per-status counts over *all* documents (parents +
 *                       children combined), to match what each status tile
 *                       does today via `reqStatus=X` (which has no
 *                       parent/child filter).
 */
export const getPipelineCounts = async (req: Request, res: Response) => {
  try {
    const archive = String(req.query.archive || "").toLowerCase() === "true";
    const Model = archive ? ArchiveRequirement : RequirementModel;

    const STATUSES = [
      "New Working",
      "Submission in progress",
      "Submitted",
      "Interviewed",
      "Project Active",
      "Project Inactive",
      "Cancelled",
    ];

    // One aggregation, one DB round-trip. `$facet` runs each branch in
    // parallel against the same input set so the planner can share work
    // where possible.
    const facets: Record<string, unknown[]> = {
      all: [
        {
          $match: {
            $or: [
              { parentReqID: { $exists: false } },
              { parentReqID: null },
              { parentReqID: "" },
            ],
          },
        },
        { $count: "n" },
      ],
      allAssigned: [
        { $match: { parentReqID: { $exists: true, $ne: "" } } },
        { $count: "n" },
      ],
    };
    for (const s of STATUSES) {
      facets[s] = [{ $match: { reqStatus: s } }, { $count: "n" }];
    }

    const [result] = await Model.aggregate([{ $facet: facets }]);
    const pick = (key: string): number =>
      ((result?.[key] as Array<{ n?: number }> | undefined)?.[0]?.n) || 0;

    const byStatus: Record<string, number> = {};
    for (const s of STATUSES) byStatus[s] = pick(s);

    res.status(200).json({
      status: "success",
      data: {
        all: pick("all"),
        allAssigned: pick("allAssigned"),
        byStatus,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error: getErrorMessage(error),
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

    // Event 1 — notify each newly-assigned marketer. Multiple assignments in
    // one request fan out to N notifications in one DB round-trip via the
    // service's `insertMany`. The actor (the assigner) is auto-excluded so
    // they don't ping themselves when self-assigning.
    if (created.length > 0) {
      const actor = req.user as UserDoc | undefined;
      void emitNotification({
        recipients: created
          .map((c) => c.assignedToRef as unknown)
          .filter(Boolean) as Array<string>,
        type: "REQUIREMENT_ASSIGNED",
        title: `New requirement assigned: ${parent.reqID}`,
        body: `${actor?.firstName || "Someone"} assigned ${parent.reqID} (${parent.jobTitle || "—"}) to you.`,
        link: {
          kind: "requirement",
          // We send the parent reqID — the assignee's drawer can drill into
          // their own child via that page's existing assignment view.
          reqID: parent.reqID,
        },
        actor: actor
          ? {
              _id: actor._id,
              name: `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || actor.email,
            }
          : undefined,
      });
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

    // Event 2 — let the (now-former) assignee know.
    if (child.assignedToRef) {
      const actor = req.user as UserDoc | undefined;
      void emitNotification({
        recipients: [child.assignedToRef],
        type: "REQUIREMENT_UNASSIGNED",
        title: `Requirement ${child.reqID} unassigned`,
        body: `${actor?.firstName || "An admin"} removed your assignment on ${child.reqID}.`,
        link: {
          kind: "requirement",
          reqID: child.parentReqID || child.reqID,
        },
        actor: actor
          ? {
              _id: actor._id,
              name: `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || actor.email,
            }
          : undefined,
      });
    }

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
