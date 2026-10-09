import ENV_VARS from "../config/env.config";
import { classifyJob } from "./jobClassifierService";
import { SourcedJobModel } from "../models/sourcedJobModel";
import {
  FEED_ADAPTERS,
  DEFAULT_FEED_KEYS,
  NormalizedFeedJob,
} from "./feedAdapters";
import {
  stripHtml,
  decodeEntities,
  looksTechnical,
  buildFeedDedupeKey,
} from "../utils/itJobFilters";

/**
 * Free remote-feed ingestion (Phase 3) → SourcedJob review queue.
 *
 * Pulls from official public feeds (Jobicy / Remotive / We Work Remotely /
 * RemoteOK) — no scraping — and mirrors the JSearch sweep's cost discipline:
 * pre-filter BEFORE any Claude call (must have apply URL, hard-drop non-US
 * where the feed exposes geo, drop non-IT by keyword, skip already-seen),
 * then classify only the survivors with the cheap CLASSIFIER_MODEL.
 *
 * Feed listings are direct-employer and carry NO vendor contact, so they
 * enter contact-less, badged by feed, with the apply URL as the mandatory
 * jobPortalLink. Source attribution (name + original URL) is always kept;
 * the queue is internal and nothing is ever republished.
 */

export interface FeedIngestSummary {
  enabled: boolean;
  feeds: string[]; // feed keys attempted
  feedsRun: number; // feeds that returned without a hard error
  candidates: number; // unique jobs seen across feeds
  prefiltered: number; // dropped before Claude (no url / non-US / non-IT)
  alreadyProcessed: number; // skipped by sourceRef
  created: number;
  duplicates: number; // dedupeKey collision
  failed: number;
}

function numEnv(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function selectedFeedKeys(): string[] {
  const raw = ENV_VARS.IT_JOB_FEEDS;
  const keys =
    typeof raw === "string" && raw.trim()
      ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : DEFAULT_FEED_KEYS;
  // Keep only keys we actually have an adapter for.
  return keys.filter((k) => FEED_ADAPTERS[k]);
}

export async function ingestFeedJobs(): Promise<FeedIngestSummary> {
  const feeds = selectedFeedKeys();
  const perRunCap = numEnv(ENV_VARS.IT_JOB_FEEDS_PER_RUN_CAP, 80);

  const summary: FeedIngestSummary = {
    enabled: feeds.length > 0,
    feeds,
    feedsRun: 0,
    candidates: 0,
    prefiltered: 0,
    alreadyProcessed: 0,
    created: 0,
    duplicates: 0,
    failed: 0,
  };
  if (!summary.enabled) return summary;

  // ── Fetch phase: gather listings across feeds, de-duped by sourceRef. ──
  const byRef = new Map<string, NormalizedFeedJob>();
  for (const key of feeds) {
    const adapter = FEED_ADAPTERS[key];
    try {
      const jobs = await adapter.fetchJobs();
      summary.feedsRun++;
      for (const job of jobs) {
        const ref = `${adapter.name}:${job.id}`;
        if (!byRef.has(ref)) byRef.set(ref, job);
      }
    } catch (e) {
      // One flaky feed shouldn't abort the others.
      summary.failed++;
      console.error(`[feed-ingest] ${key} failed:`, (e as Error).message);
    }
  }

  const all = Array.from(byRef.entries()); // [ref, job]
  summary.candidates = all.length;

  // ── Pre-filter (no Claude): apply URL, US hard-drop, IT keyword. ──
  const passed = all.filter(([, job]) => {
    if (!job.applyUrl) return false;
    if (job.geoUS === false) return false; // feed says non-US → hard-drop
    const descText = stripHtml(job.description);
    if (!looksTechnical(job.title, descText)) return false;
    return true;
  });
  summary.prefiltered = all.length - passed.length;

  // ── Skip ones already sourced (by sourceRef) BEFORE any Claude call. ──
  const refs = passed.map(([ref]) => ref);
  const seen = new Set<string>(
    refs.length
      ? await SourcedJobModel.find({ sourceRef: { $in: refs } }).distinct(
          "sourceRef"
        )
      : []
  );

  // ── Process phase: classify survivors and create queue rows (capped). ──
  for (const [ref, job] of passed) {
    if (summary.created >= perRunCap) break;
    if (seen.has(ref)) {
      summary.alreadyProcessed++;
      continue;
    }
    try {
      const title = decodeEntities(job.title);
      const company = decodeEntities(job.company);
      const dedupeKey = buildFeedDedupeKey(title, company, job.id);
      if (await SourcedJobModel.exists({ dedupeKey })) {
        summary.duplicates++;
        continue;
      }

      const descText = stripHtml(job.description);
      const classification = await classifyJob({
        jobTitle: title,
        jobDescription: descText,
        location: job.location,
        rawText: `${title}\n${company}\n${job.location}\n\n${descText}`,
      });

      const postedDate = job.postedAt ? new Date(job.postedAt) : null;
      const receivedAt =
        postedDate && !Number.isNaN(postedDate.getTime())
          ? postedDate
          : new Date();

      await SourcedJobModel.create({
        jobTitle: title,
        jobDescription: descText.slice(0, 8000),
        jobPortalLink: job.applyUrl, // mandatory — guaranteed by pre-filter
        clientCompany: company || undefined,
        clientAddress: job.location || undefined,
        reqKeywords: job.tags && job.tags.length ? job.tags.join(", ") : undefined,
        rate: job.salary ? [job.salary] : undefined,
        remote: ["Remote"],
        source: "feed",
        sourceName: job.sourceName,
        sourceRef: ref,
        receivedAt,
        rawExcerpt: descText.slice(0, 4000),
        is100Remote: classification.is100Remote,
        remoteScopeUS: classification.remoteScopeUS,
        isTechnical: classification.isTechnical,
        workAuth: classification.workAuth,
        seniority: classification.seniority,
        confidence: classification.confidence,
        classifierModel: classification.classifierModel,
        hasVendorContact: false, // feed listings never carry a contact
        dedupeKey,
        status: "pending",
      });
      summary.created++;
    } catch (e) {
      summary.failed++;
      console.error("[feed-ingest] failed", ref, (e as Error).message);
    }
  }

  if (summary.created || summary.failed) {
    console.log(
      `[feed-ingest] feeds=${summary.feedsRun}/${feeds.length} candidates=${summary.candidates} prefiltered=${summary.prefiltered} new=${summary.created} dup=${summary.duplicates} seen=${summary.alreadyProcessed} failed=${summary.failed}`
    );
  }
  return summary;
}
