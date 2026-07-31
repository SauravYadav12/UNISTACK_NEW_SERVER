import { Request, Response } from "express";
import { Types } from "mongoose";
import { QuoPhoneNumberModel } from "../models/quoPhoneNumberModel";
import { QuoCallModel } from "../models/quoCallModel";
import { QuoMessageModel } from "../models/quoMessageModel";
import { QuoVoicemailModel } from "../models/quoVoicemailModel";
import {
  getCallRecordings,
  getCallSummary,
  getCallTranscript,
  getVoicemail,
  listCalls,
  listMessages,
  listPhoneNumbers,
} from "../services/quoClient";
import {
  ingestCallEvent,
  ingestMessageEvent,
  ingestVoicemail,
} from "../services/quoWebhookIngestService";

// ── Helpers ────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

function toDate(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function pageOf(req: Request) {
  const page = Math.max(1, Number(str(req.query.page)) || 1);
  const limit = Math.min(200, Math.max(1, Number(str(req.query.limit)) || 50));
  return { page, limit, skip: (page - 1) * limit };
}

// ── Numbers ────────────────────────────────────────────────────

export const listQuoPhoneNumbers = async (_req: Request, res: Response) => {
  try {
    const numbers = await QuoPhoneNumberModel.find({})
      .sort({ createdAt: 1 })
      .lean();
    res.status(200).json({ data: numbers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const syncQuoPhoneNumbers = async (_req: Request, res: Response) => {
  try {
    const remote = await listPhoneNumbers();
    const now = new Date();
    for (const num of remote.data || []) {
      await QuoPhoneNumberModel.findOneAndUpdate(
        { quoId: num.id },
        {
          $set: {
            e164: num.number,
            assignedUserId: num.users?.[0]?.id,
            syncedAt: now,
          },
          $setOnInsert: { quoId: num.id },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    const numbers = await QuoPhoneNumberModel.find({})
      .sort({ createdAt: 1 })
      .lean();
    res.status(200).json({ data: numbers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const patchQuoPhoneNumberLabel = async (req: Request, res: Response) => {
  try {
    const id = str(req.params.id);
    if (!id || !Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const label =
      typeof req.body?.label === "string" ? req.body.label.trim() : "";
    const doc = await QuoPhoneNumberModel.findByIdAndUpdate(
      id,
      { $set: { label } },
      { new: true },
    ).lean();
    if (!doc) {
      res.status(404).json({ error: "Number not found" });
      return;
    }
    res.status(200).json({ data: doc });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ── Per-number reconcile ───────────────────────────────────────

/**
 * Belt-and-braces "pull anything webhooks may have missed for this
 * number". Rate-limited to 1 run per number per 30 s (in-process
 * ledger; a restart resets it).
 *
 * Because Quo's GET /v1/calls requires `participants`, we can only
 * reconcile against counterparties we've already seen — a truly-lost
 * first-call from a new counterparty stays lost until Quo retries
 * the webhook. Messages have no participants constraint so one clean
 * call fills the SMS gap.
 */
const reconcileLedger = new Map<string, number>();

export const reconcileQuoPhoneNumber = async (req: Request, res: Response) => {
  try {
    const id = str(req.params.id);
    if (!id || !Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const now = Date.now();
    const last = reconcileLedger.get(id) || 0;
    if (now - last < 30_000) {
      res.status(429).json({
        error: "Reconcile just ran for this number — try again in a moment.",
      });
      return;
    }
    reconcileLedger.set(id, now);

    const phone = await QuoPhoneNumberModel.findById(id).lean();
    if (!phone) {
      res.status(404).json({ error: "Number not found" });
      return;
    }

    // Determine the "since" watermark from the most recent event in
    // any of the mirror collections.
    const [lastCall, lastMessage] = await Promise.all([
      QuoCallModel.findOne({ phoneNumberId: phone._id })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean(),
      QuoMessageModel.findOne({ phoneNumberId: phone._id })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean(),
    ]);
    const sinceMs = Math.max(
      lastCall?.createdAt ? new Date(lastCall.createdAt).getTime() : 0,
      lastMessage?.createdAt ? new Date(lastMessage.createdAt).getTime() : 0,
      // If we've never seen anything, bound the reconcile to the last
      // 7 days — deeper history isn't reachable via Quo's participants-
      // required constraint anyway.
      now - 7 * 24 * 60 * 60 * 1000,
    );
    const since = new Date(sinceMs).toISOString();

    // ── Messages (no participants constraint) ──
    let messageCount = 0;
    try {
      const mres = await listMessages({
        phoneNumberId: phone.quoId,
        createdAfter: since,
        maxResults: 100,
      });
      for (const m of mres.data || []) {
        await ingestMessageEvent(m);
        messageCount++;
      }
    } catch {
      // Quo may reject if there are no messages — swallow and move on.
    }

    // ── Calls — loop the recent counterparties in the mirror ──
    const recentCps = await QuoCallModel.aggregate([
      { $match: { phoneNumberId: phone._id } },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      { $unwind: "$participants" },
      { $group: { _id: "$participants" } },
      { $limit: 10 },
    ]);
    let callCount = 0;
    for (const cp of recentCps as Array<{ _id: string }>) {
      if (cp._id === phone.e164) continue;
      try {
        const cres = await listCalls({
          phoneNumberId: phone.quoId,
          participants: cp._id,
          createdAfter: since,
          maxResults: 50,
        });
        for (const c of cres.data || []) {
          await ingestCallEvent("reconcile", c);
          callCount++;
        }
      } catch {
        // Continue with other counterparties on any single failure.
      }
    }

    res.status(200).json({
      data: {
        reconciled: true,
        since,
        counts: { messages: messageCount, calls: callCount },
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ── Timeline reads (from local mirror) ────────────────────────

/**
 * Common filter used by all three list endpoints — resolves phone /
 * date range / counterparty search / cursor.
 */
function buildTimelineQuery(req: Request) {
  const q: Record<string, unknown> = {};
  const phoneNumberId = str(req.query.phoneNumberId);
  if (phoneNumberId && Types.ObjectId.isValid(phoneNumberId)) {
    q.phoneNumberId = new Types.ObjectId(phoneNumberId);
  }
  const from = toDate(req.query.from);
  const to = toDate(req.query.to);
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    q.createdAt = range;
  }
  const since = toDate(req.query.since);
  if (since) {
    // `since` overrides the from/to range — used by the 30 s poll for
    // a "give me anything newer than X" delta.
    q.createdAt = { $gt: since };
  }
  return q;
}

export const listQuoCalls = async (req: Request, res: Response) => {
  try {
    const q = buildTimelineQuery(req);
    const direction = str(req.query.direction);
    if (direction === "incoming" || direction === "outgoing") {
      q.direction = direction;
    }
    const search = str(req.query.search);
    if (search) {
      q.participants = { $regex: search.replace(/[^\d+]/g, ""), $options: "i" };
    }
    const { limit, skip } = pageOf(req);
    const [rows, total] = await Promise.all([
      QuoCallModel.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      QuoCallModel.countDocuments(q),
    ]);
    res.status(200).json({ data: { rows, total } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const listQuoMessages = async (req: Request, res: Response) => {
  try {
    const q = buildTimelineQuery(req);
    const conversationId = str(req.query.conversationId);
    if (conversationId) q.conversationId = conversationId;
    const search = str(req.query.search);
    if (search) {
      q.$or = [
        { from: { $regex: search.replace(/[^\d+]/g, ""), $options: "i" } },
        { to: { $regex: search.replace(/[^\d+]/g, ""), $options: "i" } },
        { text: { $regex: search, $options: "i" } },
      ];
    }
    const { limit, skip } = pageOf(req);
    const sortDir = conversationId ? 1 : -1;
    const [rows, total] = await Promise.all([
      QuoMessageModel.find(q)
        .sort({ createdAt: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      QuoMessageModel.countDocuments(q),
    ]);
    res.status(200).json({ data: { rows, total } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const listQuoVoicemails = async (req: Request, res: Response) => {
  try {
    const q = buildTimelineQuery(req);
    const { limit, skip } = pageOf(req);
    const [rows, total] = await Promise.all([
      QuoVoicemailModel.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      QuoVoicemailModel.countDocuments(q),
    ]);
    res.status(200).json({ data: { rows, total } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

/**
 * Unified activity feed — merges calls + voicemails + latest-message-
 * per-conversation into one reverse-chronological list. Powers the
 * right-pane timeline. SMS is rolled up by conversationId so each
 * counterparty thread renders as ONE card, not one card per message.
 *
 * `direction` filter semantics:
 *   • incoming  → calls + messages where direction='incoming' + all voicemails
 *                 (voicemails are always someone leaving one for us — i.e.
 *                 inherently incoming).
 *   • outgoing  → calls + messages where direction='outgoing' + zero
 *                 voicemails (they're never outgoing).
 *   • undefined → everything.
 */
export const listQuoActivity = async (req: Request, res: Response) => {
  try {
    const q = buildTimelineQuery(req);
    const { limit, skip } = pageOf(req);
    const direction = str(req.query.direction);
    const dirFilter =
      direction === "incoming" || direction === "outgoing" ? direction : null;

    // Add direction to the per-collection queries where the schema
    // supports it. Voicemails have no direction field, so we handle
    // them via the include/exclude flag below.
    const callQuery: Record<string, unknown> = { ...q };
    const msgQuery: Record<string, unknown> = { ...q };
    if (dirFilter) {
      callQuery.direction = dirFilter;
      msgQuery.direction = dirFilter;
    }
    const includeVoicemails = dirFilter !== "outgoing";

    const [calls, voicemails, conversations] = await Promise.all([
      QuoCallModel.find(callQuery).sort({ createdAt: -1 }).limit(500).lean(),
      includeVoicemails
        ? QuoVoicemailModel.find(q).sort({ createdAt: -1 }).limit(200).lean()
        : Promise.resolve([]),
      // Roll up messages by conversation — one row per conversation
      // with the latest message + total count in the window.
      QuoMessageModel.aggregate([
        { $match: msgQuery },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$conversationId",
            phoneNumberId: { $first: "$phoneNumberId" },
            quoPhoneNumberId: { $first: "$quoPhoneNumberId" },
            latestAt: { $first: "$createdAt" },
            latestText: { $first: "$text" },
            latestDirection: { $first: "$direction" },
            counterparties: { $addToSet: "$from" },
            counterpartiesTo: { $addToSet: "$to" },
            count: { $sum: 1 },
          },
        },
        { $sort: { latestAt: -1 } },
        { $limit: 200 },
      ]),
    ]);

    type Event =
      | { kind: "call"; at: Date; data: unknown }
      | { kind: "voicemail"; at: Date; data: unknown }
      | { kind: "conversation"; at: Date; data: unknown };

    const events: Event[] = [];
    for (const c of calls)
      events.push({ kind: "call", at: c.createdAt, data: c });
    for (const v of voicemails)
      events.push({ kind: "voicemail", at: v.createdAt, data: v });
    for (const conv of conversations as Array<{ latestAt: Date }>)
      events.push({ kind: "conversation", at: conv.latestAt, data: conv });

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    const paged = events.slice(skip, skip + limit);

    res
      .status(200)
      .json({ data: { rows: paged, total: events.length } });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ── Recording / voicemail audio proxy ─────────────────────────

/**
 * Client hits this endpoint; server pulls a fresh signed URL from
 * Quo and 302-redirects the audio element there. Cache-Control
 * no-store forces the browser to re-request each play session, so
 * signed-URL expiry is never user-facing.
 */
export const proxyQuoRecording = async (req: Request, res: Response) => {
  try {
    const callId = str(req.params.callId);
    if (!callId) {
      res.status(400).json({ error: "Missing callId" });
      return;
    }
    const remote = await getCallRecordings(callId);
    const url = remote.data?.[0]?.url;
    if (!url) {
      res.status(404).json({ error: "No recording for this call" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const proxyQuoVoicemail = async (req: Request, res: Response) => {
  try {
    const callId = str(req.params.callId);
    if (!callId) {
      res.status(400).json({ error: "Missing callId" });
      return;
    }
    const remote = await getVoicemail(callId);
    const url = remote.data?.recordingUrl;
    if (!url) {
      res.status(404).json({ error: "No voicemail audio for this call" });
      return;
    }
    // Also refresh our mirror row while we're here — status may have
    // flipped to `completed` since the last webhook.
    await ingestVoicemail(
      (
        await QuoCallModel.findOne({ quoCallId: callId })
          .select("quoPhoneNumberId")
          .lean()
      )?.quoPhoneNumberId || "",
      remote.data,
    );
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ── Summary + transcript pull-through (not stored) ────────────

export const getQuoCallSummary = async (req: Request, res: Response) => {
  try {
    const callId = str(req.params.callId);
    if (!callId) {
      res.status(400).json({ error: "Missing callId" });
      return;
    }
    const remote = await getCallSummary(callId);
    res.status(200).json({ data: remote.data });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getQuoCallTranscript = async (req: Request, res: Response) => {
  try {
    const callId = str(req.params.callId);
    if (!callId) {
      res.status(400).json({ error: "Missing callId" });
      return;
    }
    const remote = await getCallTranscript(callId);
    res.status(200).json({ data: remote.data });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
