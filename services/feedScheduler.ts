/**
 * IT Job Search — scheduled free-feed ingestion (Phase 3).
 *
 * Every INTERVAL (default 24h), pulls the configured public remote feeds
 * and pushes new postings into the SourcedJob review queue. Self-scheduling
 * setTimeout loop, same pattern as the email scheduler. Feeds are free, so
 * the only cost is the (pre-filtered, capped) classifier calls.
 *
 * Gated by IT_JOB_FEEDS_ENABLED !== "false" (default on). A manual run is
 * also available via POST /it-job-search/ingest/feeds.
 */
import ENV_VARS from "../config/env.config";
import { ingestFeedJobs } from "./feedIngestService";

function intervalMs(): number {
  const hours = Number(ENV_VARS.IT_JOB_FEEDS_INTERVAL_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return safe * 60 * 60 * 1000;
}

let timer: NodeJS.Timeout | null = null;
let initialised = false;

function enabled(): boolean {
  return String(ENV_VARS.IT_JOB_FEEDS_ENABLED) !== "false";
}

async function tick(): Promise<void> {
  try {
    await ingestFeedJobs();
  } catch (e) {
    console.error("[feed-ingest] tick failed:", (e as Error).message);
  } finally {
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, intervalMs());
}

export function startFeedScheduler(): void {
  if (initialised) return;
  if (!enabled()) {
    console.log("[feed-ingest] disabled (IT_JOB_FEEDS_ENABLED=false)");
    return;
  }
  initialised = true;
  console.log(
    `[feed-ingest] starting (every ${intervalMs() / 3600000}h)`
  );
  // First run shortly after boot so a fresh deploy catches up.
  setTimeout(() => {
    void tick();
  }, 15000);
}
