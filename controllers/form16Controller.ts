import { Request, Response } from "express";
import { Types, FilterQuery } from "mongoose";
import { Form16Model, Form16Doc } from "../models/form16Model";
import { UserModel, UserDoc } from "../models/userModel";
import { UserProfileModel } from "../models/userProfileModel";
import { deleteS3ObjectByUrl } from "./storageController";
import { getCurrentFYStart, getFYLabel } from "../utils/fiscalYearUtil";

/**
 * Form-16 admin controller.
 *
 * Endpoints (all super-admin gated by the route layer except `my`):
 *   POST   /form16                — create one
 *   POST   /form16/bulk           — create N (with optional publishImmediately)
 *   GET    /form16                — list (?fiscalYearStart=&published=)
 *   POST   /form16/:id/publish    — flip published:true
 *   POST   /form16/:id/unpublish  — flip published:false
 *   POST   /form16/publish-bulk   — publish every unpublished row for a given FY
 *   DELETE /form16/:id            — remove doc + drop the S3 object
 *
 * The `my` endpoint is wired through myDocumentsController + route so
 * it stays alongside the other employee-facing My Documents reads.
 */

interface SummaryRow {
  _id: string;
  user: string;
  fiscalYearStart: number;
  fiscalYearLabel: string;
  fileUrl: string;
  originalFilename?: string;
  fileSizeBytes?: number;
  employeeName: string;
  employeeId?: string;
  published: boolean;
  publishedAt?: Date;
  publishedBy?: string;
  uploadedAt: Date;
  uploadedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

function summary(doc: Form16Doc): SummaryRow {
  return {
    _id: String(doc._id),
    user: String(doc.user),
    fiscalYearStart: doc.fiscalYearStart,
    fiscalYearLabel: getFYLabel(doc.fiscalYearStart),
    fileUrl: doc.fileUrl,
    originalFilename: doc.originalFilename,
    fileSizeBytes: doc.fileSizeBytes,
    employeeName: doc.employeeName,
    employeeId: doc.employeeId,
    published: doc.published,
    publishedAt: doc.publishedAt,
    publishedBy: doc.publishedBy ? String(doc.publishedBy) : undefined,
    uploadedAt: doc.uploadedAt,
    uploadedBy: doc.uploadedBy ? String(doc.uploadedBy) : undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Resolve a user + their UserProfile and produce the denormalised
 * snapshot fields we freeze onto the Form-16 row. Returns `null` if
 * the user is missing — caller decides whether that's fatal or a
 * skip-this-row in a bulk operation.
 */
async function buildEmployeeSnapshot(
  userId: string,
): Promise<{ user: UserDoc; employeeName: string; employeeId?: string } | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const user = await UserModel.findById(userId);
  if (!user) return null;
  const profile = await UserProfileModel.findOne({
    user: user._id,
  } as FilterQuery<Record<string, unknown>>)
    .select("employeeId")
    .lean();
  const employeeName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email ||
    "Employee";
  const employeeId = (profile as { employeeId?: string } | null)?.employeeId;
  return { user, employeeName, employeeId };
}

interface CreateBody {
  userId?: string;
  fiscalYearStart?: number | string;
  fileUrl?: string;
  originalFilename?: string;
  fileSizeBytes?: number;
}

/**
 * POST /form16 — create one row. Used by the single-employee upload
 * variant from the drawer. Bulk path uses `/form16/bulk` below.
 */
export const createForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const body = (req.body || {}) as CreateBody;

    const userId = String(body.userId || "");
    const fiscalYearStart = Number(body.fiscalYearStart);
    const fileUrl = String(body.fileUrl || "").trim();
    if (
      !Types.ObjectId.isValid(userId) ||
      !Number.isFinite(fiscalYearStart) ||
      !fileUrl
    ) {
      res.status(400).json({
        error: "userId, fiscalYearStart, and fileUrl are required.",
      });
      return;
    }

    const snap = await buildEmployeeSnapshot(userId);
    if (!snap) {
      res.status(404).json({ error: "Employee not found." });
      return;
    }

    // Duplicate guard — surface a 409 with the existing row's id so
    // the drawer can offer the "Replace?" confirm. Caller decides
    // whether to delete-then-recreate or abandon.
    const existing = await Form16Model.findOne({
      user: snap.user._id,
      fiscalYearStart,
    }).lean();
    if (existing) {
      res.status(409).json({
        error: `A Form-16 for ${snap.employeeName} for FY ${getFYLabel(
          fiscalYearStart,
        )} already exists.`,
        existingId: String(existing._id),
      });
      return;
    }

    const created = await Form16Model.create({
      user: snap.user._id,
      fiscalYearStart,
      fileUrl,
      originalFilename: body.originalFilename,
      fileSizeBytes: body.fileSizeBytes,
      employeeName: snap.employeeName,
      employeeId: snap.employeeId,
      published: false,
      uploadedAt: new Date(),
      uploadedBy: admin._id,
    });

    res.status(201).json({ data: summary(created) });
  } catch (error) {
    console.error("[form16] create failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

interface BulkRow {
  userId?: string;
  fiscalYearStart?: number | string;
  fileUrl?: string;
  originalFilename?: string;
  fileSizeBytes?: number;
}

interface BulkBody {
  publishImmediately?: boolean;
  rows?: BulkRow[];
}

/**
 * POST /form16/bulk — atomic upload-and-publish for the drawer flow.
 *
 * Body: { publishImmediately?: boolean, rows: [{ userId, fiscalYearStart, fileUrl, … }] }
 *
 * Per-row try/catch so a single bad entry doesn't fail the batch.
 * Response shape `{ success, errors }` lets the drawer surface a
 * partial-failure state with per-row retry.
 *
 * When `publishImmediately: true` (the standard drawer call), each
 * created doc is also published in the same operation — no separate
 * publish round-trip. Failed rows are NOT published.
 */
export const bulkCreateForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const body = (req.body || {}) as BulkBody;
    const publishImmediately = body.publishImmediately === true;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      res.status(400).json({ error: "rows[] is required." });
      return;
    }

    const success: SummaryRow[] = [];
    const errors: Array<{ index: number; userId?: string; error: string }> = [];
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const userId = String(row.userId || "");
        const fiscalYearStart = Number(row.fiscalYearStart);
        const fileUrl = String(row.fileUrl || "").trim();
        if (
          !Types.ObjectId.isValid(userId) ||
          !Number.isFinite(fiscalYearStart) ||
          !fileUrl
        ) {
          throw new Error(
            "userId, fiscalYearStart, and fileUrl are all required.",
          );
        }
        const snap = await buildEmployeeSnapshot(userId);
        if (!snap) throw new Error("Employee not found.");

        // For bulk we do an "upsert" semantically: if a row exists,
        // we delete it (and its S3 object) and replace. This mirrors
        // the drawer's duplicate-guard "Replace?" path and avoids a
        // hard error mid-batch when HR is re-uploading.
        const existing = await Form16Model.findOne({
          user: snap.user._id,
          fiscalYearStart,
        });
        if (existing) {
          const oldUrl = existing.fileUrl;
          await existing.deleteOne();
          // Drop the old S3 object best-effort; logged on failure.
          if (oldUrl) {
            try {
              await deleteS3ObjectByUrl(oldUrl);
            } catch (e) {
              console.error(
                "[form16] bulk: failed to remove replaced S3 object",
                oldUrl,
                (e as Error).message,
              );
            }
          }
        }

        const created = await Form16Model.create({
          user: snap.user._id,
          fiscalYearStart,
          fileUrl,
          originalFilename: row.originalFilename,
          fileSizeBytes: row.fileSizeBytes,
          employeeName: snap.employeeName,
          employeeId: snap.employeeId,
          published: publishImmediately,
          publishedAt: publishImmediately ? now : undefined,
          publishedBy: publishImmediately ? admin._id : undefined,
          uploadedAt: now,
          uploadedBy: admin._id,
        });
        success.push(summary(created));
      } catch (e) {
        errors.push({
          index: i,
          userId: row.userId,
          error: (e as Error).message || "Failed to create row.",
        });
      }
    }

    res.status(207).json({
      data: { success, errors, publishedImmediately: publishImmediately },
    });
  } catch (error) {
    console.error("[form16] bulk-create failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * GET /form16 — list. Filters: `?fiscalYearStart=2024`, `?published=true`.
 * Without filters returns all (admin grid does its own client-side
 * filtering when needed).
 */
export const listForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const q: FilterQuery<Record<string, unknown>> = {};
    if (req.query.fiscalYearStart != null) {
      const fy = Number(req.query.fiscalYearStart);
      if (Number.isFinite(fy)) q.fiscalYearStart = fy;
    }
    if (typeof req.query.published === "string") {
      if (req.query.published === "true") q.published = true;
      else if (req.query.published === "false") q.published = false;
    }
    const docs = await Form16Model.find(q)
      .sort({ fiscalYearStart: -1, employeeName: 1 })
      .lean();
    res
      .status(200)
      .json({ data: docs.map((d) => summary(d as unknown as Form16Doc)) });
  } catch (error) {
    console.error("[form16] list failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * POST /form16/:id/publish — flip published:true.
 */
export const publishForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const doc = await Form16Model.findByIdAndUpdate(
      id,
      {
        $set: { published: true, publishedAt: new Date(), publishedBy: admin._id },
      },
      { new: true },
    );
    if (!doc) {
      res.status(404).json({ error: "Form-16 not found." });
      return;
    }
    res.status(200).json({ data: summary(doc) });
  } catch (error) {
    console.error("[form16] publish failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * POST /form16/:id/unpublish — flip published:false. Clears
 * `publishedAt` so the audit trail reflects the most recent action.
 */
export const unpublishForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const doc = await Form16Model.findByIdAndUpdate(
      id,
      {
        $set: { published: false },
        $unset: { publishedAt: "", publishedBy: "" },
      },
      { new: true },
    );
    if (!doc) {
      res.status(404).json({ error: "Form-16 not found." });
      return;
    }
    res.status(200).json({ data: summary(doc) });
  } catch (error) {
    console.error("[form16] unpublish failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * POST /form16/publish-bulk — publishes every unpublished row for the
 * supplied FY in one call. Scoped to a single FY per call so a stray
 * click can't accidentally surface draft rows from other years.
 */
export const publishAllForFY = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const admin = req.user as UserDoc;
    const fy = Number((req.body || {}).fiscalYearStart);
    if (!Number.isFinite(fy)) {
      res.status(400).json({ error: "fiscalYearStart is required." });
      return;
    }
    const now = new Date();
    // Mongoose 5's UpdateWriteOpResult uses `nModified`; the modern
    // `modifiedCount` field came in v6. Cast through `unknown` so this
    // compiles on the v5 typings the repo currently pins.
    const result = (await Form16Model.updateMany(
      { fiscalYearStart: fy, published: false },
      { $set: { published: true, publishedAt: now, publishedBy: admin._id } },
    )) as unknown as { nModified?: number; modifiedCount?: number };
    res.status(200).json({
      data: {
        fiscalYearStart: fy,
        modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
      },
    });
  } catch (error) {
    console.error("[form16] publish-bulk failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * DELETE /form16/:id — hard delete + remove the underlying PDF from
 * the storage bucket. Order: delete the Mongo doc first so admin sees
 * the row gone immediately; then best-effort drop the S3 object. If
 * the S3 step fails the doc is already removed (no broken-link rows
 * in the grid); the failure is logged loudly for a future janitor
 * sweep.
 */
export const deleteForm16 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id || "");
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const doc = await Form16Model.findById(id);
    if (!doc) {
      res.status(404).json({ error: "Form-16 not found." });
      return;
    }
    const fileUrl = doc.fileUrl;
    await doc.deleteOne();
    if (fileUrl) {
      try {
        await deleteS3ObjectByUrl(fileUrl);
      } catch (e) {
        console.error(
          "[form16] delete: storage cleanup failed for",
          fileUrl,
          (e as Error).message,
        );
      }
    }
    res.status(200).json({ data: { deleted: true, id } });
  } catch (error) {
    console.error("[form16] delete failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * GET /my-documents/form16 — every published Form-16 owned by the
 * calling user, sorted FY descending so the panel can default-select
 * the most recent. JWT-authenticated; no role gate (user only ever
 * sees their own rows by definition of the filter).
 */
export const getMyForm16s = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = req.user as UserDoc | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const docs = await Form16Model.find({
      user: user._id,
      published: true,
    } as FilterQuery<Record<string, unknown>>)
      .sort({ fiscalYearStart: -1 })
      .lean();
    res.status(200).json({
      data: docs.map((d) => ({
        fiscalYearStart: d.fiscalYearStart,
        fiscalYearLabel: getFYLabel(d.fiscalYearStart),
        fileUrl: d.fileUrl,
        originalFilename: d.originalFilename,
        fileSizeBytes: d.fileSizeBytes,
        publishedAt: d.publishedAt,
      })),
    });
  } catch (error) {
    console.error(
      "[form16] my-documents fetch failed:",
      (error as Error).message,
    );
    res.status(500).json({ error: "Failed to load Form-16 documents." });
  }
};

/**
 * GET /user-profiles/form16-lookup — compact list consumed by the
 * upload drawer's filename matcher. Returns the minimum set the
 * matcher needs: name, email, employeeId, PAN. Super-admin only.
 *
 * Lives in the form16 controller (rather than userProfileController)
 * so the entire Form-16 module's surface area is in one file.
 */
export const getForm16Lookup = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    // One aggregation: join active users with their UserProfile, project
    // the four matcher inputs. Inactive users are excluded since Form-16
    // is only relevant for current employees.
    const rows = await UserModel.aggregate([
      { $match: { active: true } },
      {
        $lookup: {
          from: "userprofiles",
          localField: "_id",
          foreignField: "user",
          as: "profile",
        },
      },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: "$_id",
          firstName: 1,
          lastName: 1,
          email: 1,
          employeeId: "$profile.employeeId",
          panNumber: "$profile.panNumber",
          designation: "$profile.designation",
          _id: 0,
        },
      },
    ]);
    res.status(200).json({
      data: rows.map((r: Record<string, unknown>) => ({
        userId: String(r.userId),
        name: [r.firstName, r.lastName].filter(Boolean).join(" ").trim(),
        email: r.email || "",
        employeeId: r.employeeId,
        panNumber: r.panNumber,
        designation: r.designation,
      })),
    });
  } catch (error) {
    console.error("[form16] lookup failed:", (error as Error).message);
    res.status(500).json({ error: (error as Error).message });
  }
};

// Re-export for callers that want the current FY default in their own
// validation flows — convenient one-liner so they don't import the
// util themselves.
export const currentFYStart = getCurrentFYStart;
