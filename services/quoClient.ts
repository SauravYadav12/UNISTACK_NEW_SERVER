import ENV_VARS from "../config/env.config";

/**
 * Thin wrapper for the Quo (OpenPhone) REST API using the global
 * `fetch` (same pattern as services/jsearchClient.ts — no axios).
 *
 * Auth  : `Authorization: <API_KEY>` — RAW key, NO `Bearer` prefix.
 * Base  : `https://api.quo.com`
 * Limit : 10 req/sec per key. We enforce a small client-side token
 *         bucket so a burst of reconcile-triggered lookups won't
 *         blow the ceiling. On 429 we retry ONCE after a short
 *         back-off.
 *
 * This client is only used by the reconcile flow + summary/transcript
 * pull-through + webhook registration. Everything else in the app
 * reads our local mirror.
 */

const BASE_URL = "https://api.quo.com";

// ── Token bucket rate limiter (10 req/sec) ───────────────────────
const RATE_PER_SEC = 10;
let tokens = RATE_PER_SEC;
let lastRefill = Date.now();

function refill() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed <= 0) return;
  const gained = (elapsed / 1000) * RATE_PER_SEC;
  tokens = Math.min(RATE_PER_SEC, tokens + gained);
  lastRefill = now;
}

async function take(): Promise<void> {
  refill();
  if (tokens >= 1) {
    tokens -= 1;
    return;
  }
  const waitMs = Math.ceil(((1 - tokens) / RATE_PER_SEC) * 1000);
  await new Promise((r) => setTimeout(r, waitMs));
  refill();
  tokens = Math.max(0, tokens - 1);
}

function assertKey(): string {
  if (!ENV_VARS.QUO_API_KEY) {
    throw new Error(
      "QUO_API_KEY not set — Quo integration disabled. Set env then restart.",
    );
  }
  return ENV_VARS.QUO_API_KEY;
}

async function req<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<T> {
  const key = assertKey();
  const qs =
    params && Object.keys(params).length
      ? "?" +
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join("&")
      : "";
  const url = `${BASE_URL}${path}${qs}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  await take();
  let res = await fetch(url, init);

  // One retry on 429 — waiting a full second guarantees the bucket
  // has at least one token.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1100));
    await take();
    res = await fetch(url, init);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Quo ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ── Types (only what we consume — Quo returns more fields) ──────

export interface QuoPhoneNumberDto {
  id: string;
  number: string;
  name?: string;
  users?: { id: string }[];
}

export interface QuoCallDto {
  id: string;
  phoneNumberId: string;
  participants: string[];
  direction: "incoming" | "outgoing";
  status: string;
  initiatedBy?: string;
  answeredBy?: string;
  userId?: string;
  createdAt: string;
  answeredAt?: string;
  completedAt?: string;
  duration?: number;
  forwardedFrom?: string;
  forwardedTo?: string;
  aiHandled?: string | null;
}

export interface QuoRecordingDto {
  id: string;
  url: string;
  duration?: number;
  createdAt?: string;
}

export interface QuoVoicemailDto {
  callId: string;
  from: string;
  to: string;
  status: "in-progress" | "completed";
  recordingUrl?: string;
  transcript?: string;
  duration?: number;
  createdAt: string;
}

export interface QuoMessageDto {
  id: string;
  phoneNumberId: string;
  conversationId: string;
  direction: "incoming" | "outgoing";
  from: string;
  to: string[];
  text: string;
  status: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoPage<T> {
  data: T[];
  totalItems?: number;
  nextPageToken?: string | null;
}

// ── Public API ─────────────────────────────────────────────────

export async function listPhoneNumbers(userId?: string) {
  return req<QuoPage<QuoPhoneNumberDto>>("GET", "/v1/phone-numbers", {
    userId,
  });
}

/**
 * Quo requires `participants` on this endpoint (max 1 counterparty).
 * We can't ask "give me all calls on this owned number" — hence the
 * webhook mirror. This function is only used by the per-number
 * reconcile flow, which loops counterparty-by-counterparty.
 */
export async function listCalls(opts: {
  phoneNumberId: string;
  participants: string;
  maxResults?: number;
  createdAfter?: string;
  createdBefore?: string;
  pageToken?: string;
  userId?: string;
}) {
  return req<QuoPage<QuoCallDto>>("GET", "/v1/calls", {
    phoneNumberId: opts.phoneNumberId,
    participants: opts.participants,
    maxResults: opts.maxResults ?? 50,
    createdAfter: opts.createdAfter,
    createdBefore: opts.createdBefore,
    pageToken: opts.pageToken,
    userId: opts.userId,
  });
}

export async function getCall(callId: string) {
  return req<{ data: QuoCallDto }>("GET", `/v1/calls/${callId}`);
}

export async function getCallRecordings(callId: string) {
  return req<{ data: QuoRecordingDto[] }>(
    "GET",
    `/v1/call-recordings/${callId}`,
  );
}

export async function getVoicemail(callId: string) {
  return req<{ data: QuoVoicemailDto }>(
    "GET",
    `/v1/call-voicemails/${callId}`,
  );
}

export async function getCallSummary(callId: string) {
  return req<{ data: { status: string; summary?: string; nextSteps?: string[] } }>(
    "GET",
    `/v1/call-summaries/${callId}`,
  );
}

export async function getCallTranscript(callId: string) {
  return req<{
    data: {
      status: string;
      dialogue?: Array<{
        content: string;
        start: number;
        end: number;
        identifier: string;
        userId?: string;
      }>;
    };
  }>("GET", `/v1/call-transcripts/${callId}`);
}

/**
 * Unlike calls, message listing does NOT require `participants`. Used
 * by the per-number reconcile to fill any SMS webhooks may have
 * missed.
 */
export async function listMessages(opts: {
  phoneNumberId: string;
  participants?: string;
  maxResults?: number;
  createdAfter?: string;
  createdBefore?: string;
  pageToken?: string;
}) {
  return req<QuoPage<QuoMessageDto>>("GET", "/v1/messages", {
    phoneNumberId: opts.phoneNumberId,
    participants: opts.participants,
    maxResults: opts.maxResults ?? 50,
    createdAfter: opts.createdAfter,
    createdBefore: opts.createdBefore,
    pageToken: opts.pageToken,
  });
}

export async function getMessage(id: string) {
  return req<{ data: QuoMessageDto }>("GET", `/v1/messages/${id}`);
}

/**
 * Webhook registration — used by scripts/register-quo-webhooks.ts.
 */
export async function createWebhook(
  kind: "calls" | "messages" | "call-summaries" | "call-transcripts",
  body: {
    url: string;
    events: string[];
    label?: string;
  },
) {
  return req<{ data: { id: string; url: string } }>(
    "POST",
    `/v1/webhooks/${kind}`,
    undefined,
    body,
  );
}
