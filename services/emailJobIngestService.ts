import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import ENV_VARS from "../config/env.config";
import { extractRequirementFromContent } from "./requirementExtractionService";
import { classifyJob } from "./jobClassifierService";
import { SourcedJobModel } from "../models/sourcedJobModel";

export interface IngestSummary {
  enabled: boolean;
  windowDays: number;
  candidates: number; // recent emails considered
  alreadyProcessed: number; // skipped by Message-ID
  created: number;
  duplicates: number; // same job via a different email
  failed: number;
}

function normalize(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function buildDedupeKey(
  fields: Record<string, unknown>,
  messageId?: string
): string {
  const title = normalize(fields.jobTitle as string);
  const company = normalize(
    (fields.clientCompany as string) ||
      (fields.vendorCompany as string) ||
      (fields.primeVendorCompany as string)
  );
  const email = normalize(
    (fields.vendorEmail as string) ||
      (fields.primeVendorEmail as string) ||
      (fields.clientEmail as string)
  );
  const basis = [title, company, email].filter(Boolean).join("|");
  return title ? basis : `msg:${normalize(messageId) || Date.now()}`;
}

function computeHasVendorContact(f: Record<string, unknown>): boolean {
  return Boolean(
    f.vendorEmail ||
      f.vendorPhone ||
      f.vendorPersonName ||
      f.primeVendorEmail ||
      f.primeVendorPhone ||
      f.primeVendorName
  );
}

function numEnv(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read RECENT job emails from the dedicated Gmail inbox over IMAP and push
 * new postings into the SourcedJob review queue.
 *
 * Design notes (the inbox has ~200k unseen historical messages, so we must
 * NOT grind the whole thing):
 *   - Only emails from the last `IT_JOB_LOOKBACK_DAYS` days are considered.
 *   - Newest first, hard-capped at `IT_JOB_PER_RUN_CAP` NEW extractions per
 *     run to throttle Claude cost.
 *   - Idempotent via the email Message-ID (stored as sourceRef): already-
 *     processed emails are skipped BEFORE any Claude call.
 *   - Read-only: we never set the \Seen flag or otherwise modify the inbox.
 */
export async function ingestJobEmails(): Promise<IngestSummary> {
  const user = ENV_VARS.GMAIL_USER;
  const pass = ENV_VARS.GMAIL_APP_PASSWORD;
  const windowDays = numEnv(ENV_VARS.IT_JOB_LOOKBACK_DAYS, 2);
  const perRunCap = numEnv(ENV_VARS.IT_JOB_PER_RUN_CAP, 80);
  const scanCap = perRunCap * 8; // look at this many recent emails to find new ones

  const summary: IngestSummary = {
    enabled: Boolean(user && pass),
    windowDays,
    candidates: 0,
    alreadyProcessed: 0,
    created: 0,
    duplicates: 0,
    failed: 0,
  };
  if (!summary.enabled) return summary;

  const client = new ImapFlow({
    host: (ENV_VARS.GMAIL_IMAP_HOST as string) || "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: user as string, pass: pass as string },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const uids = (await client.search({ since }, { uid: true })) as number[];
    if (!uids || !uids.length) {
      await client.logout().catch(() => {});
      return summary;
    }

    // Newest first, limited to a scan window.
    const candidates = uids.sort((a, b) => b - a).slice(0, scanCap);
    summary.candidates = candidates.length;

    // Pull envelopes in bulk to get Message-IDs cheaply, then skip the ones
    // we've already processed before spending any Claude calls.
    const uidToMessageId = new Map<number, string>();
    const messageIds: string[] = [];
    for await (const msg of client.fetch(
      candidates.join(","),
      { uid: true, envelope: true },
      { uid: true }
    )) {
      const mid = msg.envelope?.messageId || String(msg.uid);
      uidToMessageId.set(msg.uid, mid);
      messageIds.push(mid);
    }

    const existing = new Set(
      await SourcedJobModel.find({ sourceRef: { $in: messageIds } }).distinct(
        "sourceRef"
      )
    );

    // Process newest-first until we hit the per-run cap.
    for (const uid of candidates) {
      if (summary.created >= perRunCap) break;
      const messageId = uidToMessageId.get(uid);
      if (!messageId || existing.has(messageId)) {
        if (messageId && existing.has(messageId)) summary.alreadyProcessed++;
        continue;
      }
      try {
        const one = await client.fetchOne(
          uid,
          { uid: true, source: true, envelope: true, internalDate: true },
          { uid: true }
        );
        if (!one || !one.source) {
          summary.failed++;
          continue;
        }
        const parsed = await simpleParser(one.source);
        const subject = parsed.subject || one.envelope?.subject || "";
        const fromText = parsed.from?.text || "";
        const body =
          (typeof parsed.text === "string" && parsed.text) ||
          (typeof parsed.html === "string" ? parsed.html : "") ||
          "";
        const receivedAt = parsed.date || one.internalDate || new Date();
        const content =
          `Subject: ${subject}\nFrom: ${fromText}\n\n${body}`.trim();
        if (!content) continue;

        const fields = await extractRequirementFromContent({ content });
        const dedupeKey = buildDedupeKey(
          fields as Record<string, unknown>,
          messageId
        );

        if (await SourcedJobModel.exists({ dedupeKey })) {
          summary.duplicates++;
          continue;
        }

        const classification = await classifyJob({
          jobTitle: (fields as Record<string, string>).jobTitle,
          jobDescription: (fields as Record<string, string>).jobDescription,
          remote: (fields as Record<string, string[]>).remote,
          location: (fields as Record<string, string>).clientAddress,
          rawText: content,
        });

        const senderDomain = fromText.match(/@([^\s>]+)/)?.[1];

        await SourcedJobModel.create({
          ...fields,
          source: "email",
          sourceName: senderDomain || "Email",
          sourceRef: messageId,
          receivedAt,
          rawExcerpt: content.slice(0, 4000),
          is100Remote: classification.is100Remote,
          remoteScopeUS: classification.remoteScopeUS,
          isTechnical: classification.isTechnical,
          workAuth: classification.workAuth,
          seniority: classification.seniority,
          confidence: classification.confidence,
          classifierModel: classification.classifierModel,
          hasVendorContact: computeHasVendorContact(
            fields as Record<string, unknown>
          ),
          dedupeKey,
          status: "pending",
        });
        summary.created++;
      } catch (e) {
        summary.failed++;
        console.error(
          "[email-ingest] failed uid",
          uid,
          (e as Error).message
        );
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  if (summary.created || summary.failed) {
    console.log(
      `[email-ingest] window=${windowDays}d candidates=${summary.candidates} new=${summary.created} dup=${summary.duplicates} seen=${summary.alreadyProcessed} failed=${summary.failed}`
    );
  }
  return summary;
}
