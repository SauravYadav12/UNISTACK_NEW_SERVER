/**
 * IT Job Search — real-time inbox watcher (IMAP IDLE).
 *
 * Replaces the old 20-minute polling scheduler. Holds a persistent IMAP
 * connection to the dedicated job inbox and reacts the moment new mail
 * arrives: imapflow auto-enters IDLE and emits an `exists` event on new
 * messages, which triggers an ingest so the position shows up in the
 * review queue within seconds — no manual "refresh" needed.
 *
 * Robustness:
 *   - On every (re)connect it first runs a catch-up ingest, so anything
 *     that landed while the connection was down is still picked up.
 *   - `close`/`error` trigger an auto-reconnect with a fixed backoff.
 *   - A busy/pending guard coalesces bursts so only one ingest runs at a
 *     time (the ingest itself is idempotent — dedupe by Message-ID).
 *
 * The actual extraction/classification reuses ingestJobEmails() (which
 * opens its own short-lived connection); this watcher only detects "new
 * mail arrived" and fires it.
 *
 * Gated by IT_JOB_INGEST_ENABLED !== "false" + GMAIL creds.
 */
import { ImapFlow } from "imapflow";
import ENV_VARS from "../config/env.config";
import { ingestJobEmails } from "./emailJobIngestService";

const RECONNECT_MS = 15000;

let client: ImapFlow | null = null;
let initialised = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let busy = false;
let pending = false;

function enabled(): boolean {
  if (String(ENV_VARS.IT_JOB_INGEST_ENABLED) === "false") return false;
  return Boolean(ENV_VARS.GMAIL_USER && ENV_VARS.GMAIL_APP_PASSWORD);
}

/** Run an ingest; coalesce overlapping triggers into one trailing run. */
async function triggerIngest(): Promise<void> {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  try {
    await ingestJobEmails();
  } catch (e) {
    console.error("[it-job-idle] ingest failed:", (e as Error).message);
  } finally {
    busy = false;
    if (pending) {
      pending = false;
      void triggerIngest();
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, RECONNECT_MS);
}

async function connect(): Promise<void> {
  // Tear down any previous client reference before making a new one.
  client = new ImapFlow({
    host: (ENV_VARS.GMAIL_IMAP_HOST as string) || "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: ENV_VARS.GMAIL_USER as string,
      pass: ENV_VARS.GMAIL_APP_PASSWORD as string,
    },
    logger: false,
    emitLogs: false,
  });

  client.on("error", (err: Error) => {
    console.error("[it-job-idle] imap error:", err.message);
  });
  client.on("close", () => {
    console.warn("[it-job-idle] connection closed; reconnecting soon");
    scheduleReconnect();
  });
  // imapflow emits `exists` whenever the mailbox message count grows.
  client.on("exists", () => {
    console.log("[it-job-idle] new mail detected → ingesting");
    void triggerIngest();
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    console.log("[it-job-idle] watching INBOX (IMAP IDLE)");
    // Catch up on anything that arrived while we were away, then let
    // imapflow hold the connection in IDLE for real-time events.
    void triggerIngest();
  } catch (e) {
    console.error("[it-job-idle] connect failed:", (e as Error).message);
    scheduleReconnect();
  }
}

export function startEmailIdleWatcher(): void {
  if (initialised) return;
  if (!enabled()) {
    console.log(
      "[it-job-idle] disabled (set GMAIL_USER + GMAIL_APP_PASSWORD, and IT_JOB_INGEST_ENABLED!=false)"
    );
    return;
  }
  initialised = true;
  console.log("[it-job-idle] starting real-time inbox watcher");
  void connect();
}
