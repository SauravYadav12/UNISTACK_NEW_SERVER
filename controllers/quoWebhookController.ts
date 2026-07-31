import { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import ENV_VARS from "../config/env.config";
import { QuoWebhookEventModel } from "../models/quoWebhookEventModel";
import {
  ingestCallEvent,
  ingestCallSummary,
  ingestCallTranscript,
  ingestMessageEvent,
  ingestRecordingCompleted,
  ingestVoicemail,
} from "../services/quoWebhookIngestService";
import {
  QuoCallDto,
  QuoMessageDto,
  QuoVoicemailDto,
} from "../services/quoClient";

/**
 * Public webhook receiver — `POST /webhooks/quo/:secret/:kind`.
 *
 * Defense: `:secret` in the path is compared to QUO_WEBHOOK_SECRET
 * env with a constant-time equality check. Mismatch → fast 401.
 * (Quo docs don't clearly document an HMAC signature header; if the
 * OpenAPI spec confirms one exists, we can move to header signing
 * later and drop the URL secret.)
 *
 * Idempotency: event.id is unique per delivery. First write wins;
 * duplicates are silent-200.
 *
 * The receiver ALWAYS returns 200 quickly. Ingest is awaited but
 * kept lean — any slow follow-up work (recording resolution, etc.)
 * happens on-demand from the admin API, not here.
 */

function secretOk(supplied: string): boolean {
  const expected = ENV_VARS.QUO_WEBHOOK_SECRET;
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Quo event payloads land as `{ id, type, apiVersion, createdAt, data: {...} }`.
// Kept intentionally loose (unknown) — each case below casts to the
// specific DTO it needs.
type QuoEvent = {
  id: string;
  type: string;
  apiVersion?: string;
  createdAt?: string;
  data?: unknown;
};

function unwrap<T>(evt: QuoEvent): T | undefined {
  const d = evt.data as { object?: T } | T | undefined;
  if (!d) return undefined;
  if (typeof d === "object" && d !== null && "object" in (d as object)) {
    return (d as { object?: T }).object;
  }
  return d as T;
}

export const receiveQuoWebhook = async (req: Request, res: Response) => {
  const supplied = typeof req.params.secret === "string" ? req.params.secret : "";
  if (!secretOk(supplied)) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const kind = String(req.params.kind || "");
  const event = req.body as QuoEvent;
  if (!event?.id || !event?.type) {
    res.status(200).json({ ok: true, ignored: "missing id or type" });
    return;
  }

  // Idempotency ledger — insert first; if the id already exists we
  // silent-200. Uses the unique index to serialise concurrent
  // deliveries of the same event.
  try {
    await QuoWebhookEventModel.create({
      eventId: event.id,
      kind,
      receivedAt: new Date(),
    });
  } catch (e) {
    // Duplicate — already processed. ACK and stop.
    res.status(200).json({ ok: true, dedup: true });
    return;
  }

  try {
    switch (event.type) {
      case "call.ringing":
      case "call.completed":
      case "call.answered":
      case "call.no-answer":
      case "call.forwarded":
      case "call.missed":
      case "call.abandoned": {
        const call = unwrap<QuoCallDto>(event);
        if (call?.id) await ingestCallEvent(event.type, call);
        break;
      }
      case "call.recording.completed": {
        // TEMPORARY: log the raw payload so we can see the exact
        // field names Quo uses. Once verified, this can drop back to
        // silent parsing.
        console.log(
          "[quo webhook] call.recording.completed raw payload:",
          JSON.stringify(event.data, null, 2),
        );
        const data = unwrap<{
          callId?: string;
          id?: string;
          url?: string;
          recordings?: Array<{ id: string; url?: string }>;
        }>(event);
        // Support both shapes: `{callId, recordings: [{id}]}` AND
        // `{id, callId, url}` (single recording object).
        const callId = data?.callId || data?.id;
        let recIds: string[] = [];
        if (data?.recordings?.length) {
          recIds = data.recordings.map((r) => r.id);
        } else if (data?.id) {
          recIds = [data.id];
        }
        if (callId && recIds.length) {
          await ingestRecordingCompleted(callId, recIds);
        } else {
          console.warn(
            "[quo webhook] recording.completed missing callId/recIds — check payload above",
          );
        }
        break;
      }
      case "call.summary.completed": {
        const data = unwrap<{ callId?: string; summary?: string }>(event);
        if (data?.callId) await ingestCallSummary(data.callId, data.summary);
        break;
      }
      case "call.transcript.completed": {
        const data = unwrap<{
          callId?: string;
          dialogue?: Array<{
            content: string;
            start: number;
            end: number;
            identifier: string;
            userId?: string;
          }>;
        }>(event);
        if (data?.callId && data.dialogue) {
          await ingestCallTranscript(data.callId, data.dialogue);
        }
        break;
      }
      case "call.voicemail.completed":
      case "call.voicemail.received": {
        const data = unwrap<QuoVoicemailDto & { phoneNumberId?: string }>(event);
        if (data?.callId) {
          await ingestVoicemail(data.phoneNumberId || "", data);
        }
        break;
      }
      case "message.received":
      case "message.delivered": {
        const message = unwrap<QuoMessageDto>(event);
        if (message?.id) await ingestMessageEvent(message);
        break;
      }
      default:
        // Unknown event kinds are recorded (via the ledger insert
        // above) but not acted on. They'll show up under
        // `QuoWebhookEvent` for later debugging.
        break;
    }
  } catch (e) {
    // We already ACKed by inserting the ledger row above; log the
    // ingest failure but don't 5xx (which would cause Quo to retry
    // and hit the ledger dedup on the next delivery).
    console.error("Quo ingest failure", event.type, event.id, e);
  }

  res.status(200).json({ ok: true });
};
