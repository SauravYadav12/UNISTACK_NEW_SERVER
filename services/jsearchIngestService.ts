import ENV_VARS from "../config/env.config";
import {
  searchJobsOnJsearch,
  JsearchConfigError,
  JsearchQuotaExceededError,
  JsearchUpstreamError,
} from "./jsearchClient";
import { NormalizedJob } from "../utils/jobBoardNormalizer";
import { classifyJob } from "./jobClassifierService";
import { SourcedJobModel } from "../models/sourcedJobModel";

/**
 * JSearch board sweep → SourcedJob review queue (Phase 2).
 *
 * Phase 1 sources jobs from a dedicated inbox (rich: has vendor contact).
 * This sources from JSearch (Google-for-Jobs aggregator → LinkedIn /
 * Indeed / Dice / Monster / CareerBuilder / ZipRecruiter). Board listings
 * have NO vendor contact — just a company and an apply URL — so they enter
 * the queue contact-less, badged by publisher, with the apply URL as the
 * mandatory `jobPortalLink` a human uses to chase the vendor.
 *
 * Trigger: MANUAL ONLY (no scheduler). A reviewer clicks "Search job
 * boards" → POST /it-job-search/ingest/jsearch. Cost control is a
 * deliberate pre-filter BEFORE any Claude call (drop no-URL / not-remote /
 * non-IT / already-seen), then classify only the survivors with the cheap
 * CLASSIFIER_MODEL. JSearch is already structured, so there is NO
 * extraction pass (unlike the email path) — we map its fields directly.
 */

export interface JsearchIngestSummary {
  enabled: boolean; // JSEARCH_RAPIDAPI_KEY present
  queriesRun: number;
  candidates: number; // unique normalized jobs seen across queries
  prefiltered: number; // dropped before Claude (no url / not remote / non-IT)
  alreadyProcessed: number; // skipped by sourceRef (JSearch job id)
  created: number;
  duplicates: number; // dedupeKey collision (same job via another route)
  failed: number;
  quotaRemaining?: number;
  quotaExceeded?: boolean;
}

/**
 * Curated default role set — common C2C remote IT roles. Override with a
 * comma-separated IT_JOB_JSEARCH_QUERIES env var without a code change.
 */
const DEFAULT_QUERIES = [
  "React Developer",
  "Java Developer",
  "Python Developer",
  ".NET Developer",
  "Node.js Developer",
  "Full Stack Developer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Data Engineer",
  "QA Automation Engineer",
  "Salesforce Developer",
  "Business Analyst",
];

// Lightweight IT gate used BEFORE spending a Claude call. A negative word
// in the TITLE drops the row outright; otherwise we require at least one
// positive signal in the title or the first chunk of the description.
const IT_POSITIVE = [
  "develop",
  "engineer",
  "software",
  "programmer",
  "java",
  "python",
  "javascript",
  "typescript",
  "react",
  "angular",
  "vue",
  "node",
  ".net",
  "c#",
  "golang",
  "rust",
  "devops",
  "sre",
  "cloud",
  "aws",
  "azure",
  "gcp",
  "kubernetes",
  "docker",
  "data engineer",
  "data scientist",
  "machine learning",
  " ml ",
  " ai ",
  "qa",
  "sdet",
  "test automation",
  "architect",
  "full stack",
  "fullstack",
  "backend",
  "frontend",
  "front end",
  "back end",
  "database",
  "dba",
  "sql",
  "security",
  "cyber",
  "network",
  "salesforce",
  "sap",
  "oracle",
  "etl",
  "api",
  "mobile",
  "ios",
  "android",
  "information technology",
  "scrum master",
  "business analyst",
  "systems analyst",
  "ui/ux",
];
const IT_NEGATIVE_TITLE = [
  "nurse",
  "driver",
  "warehouse",
  "retail",
  "cashier",
  "waiter",
  "cook",
  "chef",
  "janitor",
  "cleaner",
  "teacher",
  "caregiver",
  "therapist",
  "physician",
  "dental",
  "pharmacist",
  "accountant",
  "bookkeeper",
  "receptionist",
  "insurance agent",
  "real estate",
  "mechanic",
  "electrician",
  "welder",
  "plumber",
  "security guard",
  "truck",
];

function numEnv(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalize(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/**
 * JSearch jobs carry no contact, so the dedupe basis is title|company —
 * identical to the email path's key when no vendor email is present, so a
 * board listing and an email for the same role can collapse together.
 */
function buildDedupeKey(job: NormalizedJob): string {
  const title = normalize(job.title);
  const company = normalize(job.company);
  const basis = [title, company].filter(Boolean).join("|");
  return title ? basis : `jsearch:${normalize(job.id) || Date.now()}`;
}

function looksTechnical(job: NormalizedJob): boolean {
  const title = (job.title || "").toLowerCase();
  if (IT_NEGATIVE_TITLE.some((n) => title.includes(n))) return false;
  const haystack = `${title} ${(job.description || "").slice(0, 600).toLowerCase()}`;
  return IT_POSITIVE.some((p) => haystack.includes(p));
}

function getQueries(): string[] {
  const raw = ENV_VARS.IT_JOB_JSEARCH_QUERIES;
  if (typeof raw === "string" && raw.trim()) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  return DEFAULT_QUERIES;
}

/**
 * Run the board sweep. Fetching (quota-bound) and processing (Claude-bound)
 * are separated: we gather all listings first, stopping early if JSearch
 * quota runs out, then pre-filter / dedupe / classify / create.
 */
export async function ingestJsearchJobs(): Promise<JsearchIngestSummary> {
  const summary: JsearchIngestSummary = {
    enabled: Boolean(ENV_VARS.JSEARCH_RAPIDAPI_KEY),
    queriesRun: 0,
    candidates: 0,
    prefiltered: 0,
    alreadyProcessed: 0,
    created: 0,
    duplicates: 0,
    failed: 0,
  };
  if (!summary.enabled) return summary;

  const perRunCap = numEnv(ENV_VARS.IT_JOB_JSEARCH_PER_RUN_CAP, 60);
  const datePostedRaw = String(
    ENV_VARS.IT_JOB_JSEARCH_DATE_POSTED || "3days"
  );
  const datePosted = (
    ["all", "today", "3days", "week", "month"] as const
  ).includes(datePostedRaw as never)
    ? (datePostedRaw as "all" | "today" | "3days" | "week" | "month")
    : "3days";

  // ── Fetch phase: gather listings across the role set, de-duped by id. ──
  // Queries run in small concurrent batches so the sweep finishes in a
  // fraction of the time of a fully sequential loop.
  const byId = new Map<string, NormalizedJob>();
  const queries = getQueries();
  const CONCURRENCY = 4;
  let configMissing = false;
  try {
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      if (summary.quotaExceeded || configMissing) break;
      const batch = queries.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((query) =>
          searchJobsOnJsearch({
            query,
            location: "Remote",
            datePosted,
            remoteOnly: true,
          })
        )
      );
      for (const s of settled) {
        if (s.status === "fulfilled") {
          summary.queriesRun++;
          for (const job of s.value.jobs) {
            if (job.id && !byId.has(job.id)) byId.set(job.id, job);
          }
          if (typeof s.value.quota.remaining === "number") {
            summary.quotaRemaining = s.value.quota.remaining;
            if (s.value.quota.remaining <= 0) summary.quotaExceeded = true;
          }
        } else {
          const err = s.reason;
          if (err instanceof JsearchQuotaExceededError) {
            summary.quotaExceeded = true;
            summary.quotaRemaining = 0;
          } else if (err instanceof JsearchConfigError) {
            configMissing = true;
          } else {
            // One bad query (upstream or otherwise) shouldn't abort the sweep.
            summary.failed++;
            console.error(
              "[jsearch-ingest] query failed:",
              (err as Error).message
            );
          }
        }
      }
    }
  } catch (e) {
    console.error("[jsearch-ingest] fetch phase failed:", (e as Error).message);
  }
  if (configMissing) {
    summary.enabled = false;
    return summary;
  }

  const all = Array.from(byId.values());
  summary.candidates = all.length;

  // ── Pre-filter (no Claude): must have apply URL, be remote, look IT. ──
  const passed = all.filter((job) => {
    if (!job.applyUrl) return false;
    if (!job.isRemote) return false;
    if (!looksTechnical(job)) return false;
    return true;
  });
  summary.prefiltered = all.length - passed.length;

  // ── Skip ones already sourced (by JSearch id) BEFORE any Claude call. ──
  const ids = passed.map((j) => j.id);
  const seen = new Set<string>(
    ids.length
      ? await SourcedJobModel.find({ sourceRef: { $in: ids } }).distinct(
          "sourceRef"
        )
      : []
  );

  // ── Process phase: classify survivors and create queue rows (capped). ──
  for (const job of passed) {
    if (summary.created >= perRunCap) break;
    if (seen.has(job.id)) {
      summary.alreadyProcessed++;
      continue;
    }
    try {
      const dedupeKey = buildDedupeKey(job);
      if (await SourcedJobModel.exists({ dedupeKey })) {
        summary.duplicates++;
        continue;
      }

      const classification = await classifyJob({
        jobTitle: job.title,
        jobDescription: job.description,
        location: job.location,
        rawText: `${job.title}\n${job.company}\n${job.location}\n\n${job.description}`,
      });

      const postedDate = job.postedAt ? new Date(job.postedAt) : null;
      const receivedAt =
        postedDate && !Number.isNaN(postedDate.getTime())
          ? postedDate
          : new Date();

      await SourcedJobModel.create({
        jobTitle: job.title,
        jobDescription: (job.description || "").slice(0, 8000),
        employementType: job.employmentType || undefined,
        jobPortalLink: job.applyUrl, // mandatory — guaranteed by pre-filter
        clientCompany: job.company || undefined,
        clientAddress: job.location || undefined,
        rate: job.salary ? [job.salary] : undefined,
        remote: ["Remote"],
        source: "jsearch",
        sourceName: job.publisher || "Job board",
        sourceRef: job.id,
        receivedAt,
        rawExcerpt: (job.description || "").slice(0, 4000),
        is100Remote: classification.is100Remote,
        remoteScopeUS: classification.remoteScopeUS,
        isTechnical: classification.isTechnical,
        workAuth: classification.workAuth,
        seniority: classification.seniority,
        confidence: classification.confidence,
        classifierModel: classification.classifierModel,
        hasVendorContact: false, // board listings never carry a contact
        dedupeKey,
        status: "pending",
      });
      summary.created++;
    } catch (e) {
      summary.failed++;
      console.error(
        "[jsearch-ingest] failed job",
        job.id,
        (e as Error).message
      );
    }
  }

  if (summary.created || summary.failed || summary.quotaExceeded) {
    console.log(
      `[jsearch-ingest] queries=${summary.queriesRun} candidates=${summary.candidates} prefiltered=${summary.prefiltered} new=${summary.created} dup=${summary.duplicates} seen=${summary.alreadyProcessed} failed=${summary.failed} quotaRemaining=${summary.quotaRemaining ?? "?"}${summary.quotaExceeded ? " QUOTA-EXCEEDED" : ""}`
    );
  }
  return summary;
}
