import { Request, Response } from "express";
import moment from "moment";
import { Types } from "mongoose";
import { ChessLeadModel } from "../models/chessLeadModel";
import ChessLeadLogModel from "../models/chessLead.log.model";
import { getErrorMessage, sequenceId } from "../utils/utils";

/** Read-side filters accepted by GET /chess-leads. All optional. */
interface ListQuery {
  status?: string;
  priority?: string;
  stateOrCity?: string;
  q?: string;      // fuzzy search on academyName / mobileNumber / leadId
  page?: string;
  limit?: string;
}

export const listChessLeads = async (req: Request, res: Response) => {
  try {
    const {
      status,
      priority,
      stateOrCity,
      q,
      page = "1",
      limit = "50",
    } = req.query as ListQuery;

    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (stateOrCity) {
      // Free-text "State / City" filter — matches across all four
      // location fields (legacy + the new triplet) so old rows stay
      // findable and typing "Tamil" surfaces state OR city hits.
      const locRx = new RegExp(stateOrCity, "i");
      query.$or = [
        { stateOrCity: locRx },
        { country: locRx },
        { state: locRx },
        { city: locRx },
      ];
    }
    if (q && q.trim()) {
      const rx = new RegExp(q.trim(), "i");
      // When both filters are set, AND their $or arrays via $and so
      // we don't clobber one with the other.
      const searchOr = [
        { academyName: rx },
        { mobileNumber: rx },
        { leadId: rx },
      ];
      if (query.$or) {
        (query.$and = [{ $or: query.$or }, { $or: searchOr }]);
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    const pageN = Math.max(1, parseInt(page, 10) || 1);
    const limitN = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    const skip = (pageN - 1) * limitN;

    const [results, totalDocuments] = await Promise.all([
      ChessLeadModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitN),
      ChessLeadModel.countDocuments(query),
    ]);

    res.status(200).json({
      status: "success",
      data: { results, totalDocuments, page: pageN, limit: limitN },
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const getChessLeadById = async (req: Request, res: Response) => {
  try {
    const doc = await ChessLeadModel.findById(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Lead not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const createChessLead = async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<{
      academyName: string;
      subscriptionDate: string;
      totalIds: number;
      mobileNumber: string;
      stateOrCity: string;
      country: string;
      countryIso: string;
      state: string;
      stateIso: string;
      city: string;
      pricingPerId: number;
      gstPercent: number;
      status: string;
      priority: string;
      reason: string;
      nextFollowUpDate: string;
      lastRenewalDate: string;
    }>;
    if (!body.academyName || !body.academyName.trim()) {
      res.status(400).json({ status: "failed", message: "academyName is required" });
      return;
    }
    const leadId = await sequenceId(ChessLeadModel, "leadId", "LEAD");
    const user = req.user as
      | { _id?: Types.ObjectId; firstName?: string; lastName?: string; email?: string }
      | undefined;
    const createdByName = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
      : undefined;
    const doc = await ChessLeadModel.create({
      ...body,
      leadId,
      createdBy: user?._id,
      createdByName,
    });
    // Fire a create log entry inline — the client fires its own for
    // update/delete, but on create the server has the authoritative
    // leadRef so it's cleaner to seed the log here.
    if (user?._id) {
      await ChessLeadLogModel.create({
        leadRef: doc._id,
        leadId,
        operation: "create",
        userName: createdByName || "unknown",
        userRef: user._id,
        newData: doc.toObject(),
      });
    }
    res.status(201).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const updateChessLead = async (req: Request, res: Response) => {
  try {
    const doc = await ChessLeadModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    );
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Lead not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const deleteChessLead = async (req: Request, res: Response) => {
  try {
    const doc = await ChessLeadModel.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ status: "failed", message: "Lead not found" });
      return;
    }
    res.status(200).json({ status: "success", data: doc });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

/**
 * Dashboard aggregations — one round-trip returning every tile + chart
 * the ChessLeads header renders. Cheap: five parallel countDocuments +
 * a small aggregate for MRR.
 */
export const getChessLeadStats = async (_req: Request, res: Response) => {
  try {
    const today = moment().format("YYYY-MM-DD");
    const [
      total,
      byStatus,
      byPriority,
      followUpsDueToday,
      followUpsOverdue,
      mrrAgg,
    ] = await Promise.all([
      ChessLeadModel.countDocuments({}),
      ChessLeadModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      ChessLeadModel.aggregate([
        { $group: { _id: "$priority", count: { $sum: 1 } } },
      ]),
      ChessLeadModel.countDocuments({ nextFollowUpDate: today }),
      ChessLeadModel.countDocuments({
        nextFollowUpDate: { $exists: true, $gt: "", $lt: today },
      } as Record<string, unknown>),
      // MRR proxy — sum of (totalIds × pricingPerId) across leads still
      // in New or Renewed. Rough estimate; sales can pull the exact
      // number from their own sheets. Nulls skipped by $ifNull.
      ChessLeadModel.aggregate([
        { $match: { status: { $in: ["New", "Renewed"] } } },
        {
          $group: {
            _id: null,
            mrr: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$totalIds", 0] },
                  { $ifNull: ["$pricingPerId", 0] },
                ],
              },
            },
          },
        },
      ]),
    ]);

    const statusCounts: Record<string, number> = {
      New: 0,
      Renewed: 0,
      "Not renewed": 0,
      "Not converted": 0,
    };
    for (const row of byStatus as Array<{ _id: string; count: number }>) {
      if (row._id in statusCounts) statusCounts[row._id] = row.count;
    }
    const priorityCounts: Record<string, number> = { Hot: 0, Warm: 0, Cold: 0 };
    for (const row of byPriority as Array<{ _id: string; count: number }>) {
      if (row._id in priorityCounts) priorityCounts[row._id] = row.count;
    }

    res.status(200).json({
      status: "success",
      data: {
        total,
        statusCounts,
        priorityCounts,
        followUpsDueToday,
        followUpsOverdue,
        mrr: (mrrAgg as Array<{ mrr?: number }>)[0]?.mrr || 0,
      },
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

// ── Audit log ──────────────────────────────────────────────────────────

export const getChessLeadLog = async (req: Request, res: Response) => {
  try {
    const { leadRef } = req.query as { leadRef?: string };
    const q: Record<string, unknown> = {};
    if (leadRef) q.leadRef = leadRef;
    const data = await ChessLeadLogModel.find(q).sort({ createdAt: -1 });
    res.status(200).json({ status: "success", data });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};

export const createChessLeadLog = async (req: Request, res: Response) => {
  try {
    const data = await ChessLeadLogModel.create(req.body);
    res.status(200).json({ status: "success", data });
  } catch (error) {
    res.status(400).json({ status: "failed", error: getErrorMessage(error) });
  }
};
