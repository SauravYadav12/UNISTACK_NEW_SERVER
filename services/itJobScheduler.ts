/**
 * IT Job Search — scheduled email ingestion.
 *
 * Every INTERVAL, reads the dedicated Gmail inbox (IMAP) and pushes new
 * job postings into the SourcedJob review queue. Self-scheduling setTimeout
 * loop, same pattern as the other schedulers (holiday notice, probation).
 *
 * Gated by:
 *   - IT_JOB_INGEST_ENABLED !== "false" (default on), and
 *   - GMAIL_USER + GMAIL_APP_PASSWORD being configured.
 */
import ENV_VARS from "../config/env.config";
import { ingestJobEmails } from "./emailJobIngestService";

const INTERVAL_MS = 20 * 60 * 1000; // every 20 minutes

let timer: NodeJS.Timeout | null = null;
let initialised = false;

function enabled(): boolean {
  if (String(ENV_VARS.IT_JOB_INGEST_ENABLED) === "false") return false;
  return Boolean(ENV_VARS.GMAIL_USER && ENV_VARS.GMAIL_APP_PASSWORD);
}

async function tick(): Promise<void> {
  try {
    await ingestJobEmails();
  } catch (e) {
    console.error("[it-job-ingest] tick failed:", (e as Error).message);
  } finally {
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, INTERVAL_MS);
}

export function startItJobScheduler(): void {
  if (initialised) return;
  if (!enabled()) {
    console.log(
      "[it-job-ingest] disabled (set GMAIL_USER + GMAIL_APP_PASSWORD, and IT_JOB_INGEST_ENABLED!=false)"
    );
    return;
  }
  initialised = true;
  console.log("[it-job-ingest] starting (every 20m)");
  // First run shortly after boot so a fresh deploy catches up.
  setTimeout(() => {
    void tick();
  }, 10000);
}
