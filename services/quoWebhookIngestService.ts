import { QuoPhoneNumberModel } from "../models/quoPhoneNumberModel";
import { QuoCallModel } from "../models/quoCallModel";
import { QuoMessageModel } from "../models/quoMessageModel";
import { QuoVoicemailModel } from "../models/quoVoicemailModel";
import {
  QuoCallDto,
  QuoMessageDto,
  QuoVoicemailDto,
} from "./quoClient";

/**
 * Idempotent per-event ingest helpers. Each function upserts by the
 * external id — Quo retries deliveries; running the same payload
 * twice must be a no-op / same-state update, never a duplicate row.
 *
 * The caller (quoWebhookController) has already:
 *   • checked the URL secret,
 *   • checked the QuoWebhookEvent idempotency ledger,
 *   • recorded the event id so subsequent calls short-circuit.
 * So these functions only handle the "shape the data" part.
 */

/**
 * Resolve the local phoneNumber doc for a Quo phoneNumberId. If we
 * haven't synced numbers yet the mirror insertion is silently
 * skipped — the first "Sync numbers" click will backfill later
 * events on subsequent webhooks.
 */
async function resolvePhoneNumber(quoPhoneNumberId?: string) {
  if (!quoPhoneNumberId) return null;
  return QuoPhoneNumberModel.findOne({ quoId: quoPhoneNumberId }).lean();
}

// ── Calls ──────────────────────────────────────────────────────

export async function ingestCallEvent(
  eventKind: string,
  call: QuoCallDto,
): Promise<void> {
  const phone = await resolvePhoneNumber(call.phoneNumberId);
  if (!phone) return;

  const update: Record<string, unknown> = {
    phoneNumberId: phone._id,
    quoPhoneNumberId: call.phoneNumberId,
    direction: call.direction,
    status: call.status,
    participants: call.participants || [],
    initiatedBy: call.initiatedBy,
    answeredBy: call.answeredBy,
    userId: call.userId,
    forwardedFrom: call.forwardedFrom,
    forwardedTo: call.forwardedTo,
    aiHandled: !!call.aiHandled,
  };
  if (call.createdAt) update.createdAt = new Date(call.createdAt);
  if (call.answeredAt) update.answeredAt = new Date(call.answeredAt);
  if (call.completedAt) update.completedAt = new Date(call.completedAt);
  if (typeof call.duration === "number") update.duration = call.duration;

  await QuoCallModel.findOneAndUpdate(
    { quoCallId: call.id },
    { $set: update, $setOnInsert: { quoCallId: call.id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * `call.recording.completed` payload carries the recording id (or
 * ids); we flip `hasRecording` and push the id onto the list. The
 * actual mp3 stays in Quo — we fetch a fresh URL on demand via the
 * server proxy endpoint.
 */
export async function ingestRecordingCompleted(
  callId: string,
  recordingIds: string[],
): Promise<void> {
  await QuoCallModel.findOneAndUpdate(
    { quoCallId: callId },
    {
      $set: { hasRecording: true },
      $addToSet: { recordingIds: { $each: recordingIds } },
    },
  );
}

export async function ingestCallSummary(
  callId: string,
  summary: string | undefined,
): Promise<void> {
  if (!summary) return;
  await QuoCallModel.findOneAndUpdate(
    { quoCallId: callId },
    { $set: { summary } },
  );
}

export async function ingestCallTranscript(
  callId: string,
  dialogue: Array<{
    content: string;
    start: number;
    end: number;
    identifier: string;
    userId?: string;
  }>,
): Promise<void> {
  await QuoCallModel.findOneAndUpdate(
    { quoCallId: callId },
    { $set: { transcript: dialogue } },
  );
}

// ── Messages ───────────────────────────────────────────────────

export async function ingestMessageEvent(
  message: QuoMessageDto,
): Promise<void> {
  const phone = await resolvePhoneNumber(message.phoneNumberId);
  if (!phone) return;

  await QuoMessageModel.findOneAndUpdate(
    { quoMessageId: message.id },
    {
      $set: {
        phoneNumberId: phone._id,
        quoPhoneNumberId: message.phoneNumberId,
        conversationId: message.conversationId,
        direction: message.direction,
        from: message.from,
        to: message.to || [],
        text: message.text || "",
        status: message.status,
        userId: message.userId,
        createdAt: new Date(message.createdAt),
      },
      $setOnInsert: { quoMessageId: message.id },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

// ── Voicemails ────────────────────────────────────────────────

export async function ingestVoicemail(
  quoPhoneNumberId: string,
  voicemail: QuoVoicemailDto,
): Promise<void> {
  const phone = await resolvePhoneNumber(quoPhoneNumberId);
  if (!phone) return;

  // Also flip the parent call's hasVoicemail flag so the timeline
  // can render a voicemail badge on the call card without a JOIN.
  await Promise.all([
    QuoVoicemailModel.findOneAndUpdate(
      { quoCallId: voicemail.callId },
      {
        $set: {
          phoneNumberId: phone._id,
          quoPhoneNumberId,
          from: voicemail.from,
          to: voicemail.to,
          status: voicemail.status,
          transcript: voicemail.transcript,
          durationSec: voicemail.duration,
          createdAt: new Date(voicemail.createdAt),
        },
        $setOnInsert: { quoCallId: voicemail.callId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    QuoCallModel.findOneAndUpdate(
      { quoCallId: voicemail.callId },
      { $set: { hasVoicemail: true } },
    ),
  ]);
}
