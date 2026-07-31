import express from "express";
import { receiveQuoWebhook } from "../controllers/quoWebhookController";

/**
 * Public webhook receiver mounted under `/webhooks/quo`. No jwt / no
 * roleGuard — the `:secret` path parameter is compared to
 * QUO_WEBHOOK_SECRET as the gate. See quoWebhookController for the
 * constant-time check + idempotency logic.
 *
 * Register in Quo dashboard as:
 *   POST https://<our-host>/webhooks/quo/<QUO_WEBHOOK_SECRET>/<kind>
 * where <kind> is one of: calls, messages, call-summaries,
 * call-transcripts. (See scripts/register-quo-webhooks.ts.)
 */
const quoWebhookRoute = express.Router();

quoWebhookRoute.post("/:secret/:kind", receiveQuoWebhook);

export { quoWebhookRoute };
