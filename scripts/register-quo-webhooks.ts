/**
 * Register (or re-register) the four Quo webhook endpoints against
 * this deployment. Run once per environment:
 *
 *   PUBLIC_URL=https://services.unistack.in npm run register:quo-webhooks
 *
 * Requires env: QUO_API_KEY, QUO_WEBHOOK_SECRET, PUBLIC_URL.
 *
 * Quo's webhook-create endpoints dedupe by URL, so re-running with
 * the same PUBLIC_URL + secret is a no-op.
 */

import dotenv from "dotenv";
dotenv.config();

import ENV_VARS from "../config/env.config";
import { createWebhook } from "../services/quoClient";

const KINDS = [
  {
    kind: "calls" as const,
    // Quo only allows these three on the /calls webhook. Voicemails
    // ride on `call.recording.completed` (voicemail audio is a kind
    // of recording in Quo's model) and are also pullable on demand
    // via GET /v1/call-voicemails/{callId} — which the server
    // exposes as /quo/calls/:callId/voicemail.
    events: [
      "call.ringing",
      "call.completed",
      "call.recording.completed",
    ],
    label: "Unistack — Call events",
  },
  {
    kind: "messages" as const,
    events: ["message.received", "message.delivered"],
    label: "Unistack — Message events",
  },
  {
    kind: "call-summaries" as const,
    events: ["call.summary.completed"],
    label: "Unistack — Call summaries",
  },
  {
    kind: "call-transcripts" as const,
    events: ["call.transcript.completed"],
    label: "Unistack — Call transcripts",
  },
];

async function main() {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    console.error("PUBLIC_URL env is required (e.g. https://services.unistack.in)");
    process.exit(1);
  }
  if (!ENV_VARS.QUO_API_KEY || !ENV_VARS.QUO_WEBHOOK_SECRET) {
    console.error("QUO_API_KEY and QUO_WEBHOOK_SECRET must be set");
    process.exit(1);
  }
  const secret = ENV_VARS.QUO_WEBHOOK_SECRET;

  for (const { kind, events, label } of KINDS) {
    const url = `${publicUrl.replace(/\/$/, "")}/webhooks/quo/${secret}/${kind}`;
    try {
      const res = await createWebhook(kind, { url, events, label });
      console.log(`OK ${kind} → ${res.data?.id || "(created)"}`);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: unknown } };
      console.error(
        `FAIL ${kind}`,
        err.response?.status,
        err.response?.data || (e as Error).message,
      );
    }
  }
}

main().then(() => process.exit(0));
