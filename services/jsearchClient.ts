/**
 * Thin adapter around the JSearch (RapidAPI) job-search endpoint.
 *
 * Why it's its own file
 * ─────────────────────
 * The controller stays provider-agnostic. If we later add SerpApi or a
 * different upstream, we add a second file with the same shape and the
 * controller chooses between them — no controller rewrite.
 *
 * Region is hard-locked to United States by passing `country=us` on every
 * upstream call. The frontend has no country picker; the controller also
 * validates the location against the US whitelist before getting here.
 */

import {
  normalizeJob,
  NormalizedJob,
  groupByPublisher,
} from "../utils/jobBoardNormalizer";

const JSEARCH_HOST =
  process.env.JSEARCH_RAPIDAPI_HOST || "jsearch.p.rapidapi.com";
const JSEARCH_KEY = process.env.JSEARCH_RAPIDAPI_KEY || "";

export interface JsearchSearchInput {
  query: string;
  location: string;
  datePosted?: "all" | "today" | "3days" | "week" | "month";
  employmentType?: "FULLTIME" | "CONTRACTOR" | "PARTTIME" | "INTERN";
  remoteOnly?: boolean;
}

/**
 * Each JSearch page returns ~10 jobs. The free BASIC plan charges 1
 * quota unit per page fetched, so num_pages=5 = 5 quota units per
 * fresh search. With the 6-hour shared Mongo cache, this is the right
 * balance between "enough results to look like a real board" and
 * "doesn't burn the monthly quota in a few searches".
 *
 * Override via env var if quota is tighter or looser in your install.
 */
const JSEARCH_NUM_PAGES = Math.max(
  1,
  Math.min(20, Number(process.env.JSEARCH_NUM_PAGES) || 5),
);

export interface JsearchQuota {
  remaining?: number;
  limit?: number;
}

export interface JsearchSearchResult {
  jobs: NormalizedJob[];
  byPublisher: Record<string, NormalizedJob[]>;
  quota: JsearchQuota;
}

export class JsearchQuotaExceededError extends Error {
  retryAfter?: string;
  constructor(retryAfter?: string) {
    super("JSearch quota exceeded");
    this.name = "JsearchQuotaExceededError";
    this.retryAfter = retryAfter;
  }
}

export class JsearchUpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "JsearchUpstreamError";
    this.status = status;
  }
}

/**
 * Thrown when the server is missing required configuration to reach
 * JSearch — usually a missing `JSEARCH_RAPIDAPI_KEY`. Kept distinct from
 * `JsearchUpstreamError` so the controller can return a clear, actionable
 * message instead of a generic "upstream unavailable".
 */
export class JsearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsearchConfigError";
  }
}

/**
 * Build the `query` parameter JSearch expects: keyword followed by a
 * location hint when supplied. JSearch parses "<keyword> in <location>"
 * idiomatically; appending the location to the query yields better
 * results than relying on a separate country filter alone.
 */
function buildQueryString(input: JsearchSearchInput): string {
  const keyword = input.query.trim();
  const location = input.location.trim();
  if (!location || location.toLowerCase() === "remote") return keyword;
  return `${keyword} in ${location}`;
}

function readQuotaHeaders(headers: Headers): JsearchQuota {
  const remaining = headers.get("x-ratelimit-requests-remaining");
  const limit = headers.get("x-ratelimit-requests-limit");
  return {
    remaining: remaining != null ? Number(remaining) : undefined,
    limit: limit != null ? Number(limit) : undefined,
  };
}

/**
 * Run one JSearch query and return normalized jobs + a per-board index +
 * remaining-quota hints. Throws `JsearchQuotaExceededError` on 429 and
 * `JsearchUpstreamError` on any other non-2xx — the controller maps each
 * to a clean client response.
 */
export async function searchJobsOnJsearch(
  input: JsearchSearchInput,
): Promise<JsearchSearchResult> {
  if (!JSEARCH_KEY) {
    throw new JsearchConfigError(
      "JSEARCH_RAPIDAPI_KEY is not configured on the server. Add it to .env and restart the server.",
    );
  }

  const params = new URLSearchParams();
  params.set("query", buildQueryString(input));
  // Always start at page 1; `num_pages` controls how many pages JSearch
  // bundles into the response. We deliberately don't expose pagination
  // to the caller — JSearch v2 uses opaque cursors, not page indices,
  // so asking for `page=2` would return duplicates of page 1.
  params.set("page", "1");
  params.set("num_pages", String(JSEARCH_NUM_PAGES));
  params.set("country", "us");
  if (input.datePosted && input.datePosted !== "all") {
    params.set("date_posted", input.datePosted);
  }
  if (input.employmentType) {
    params.set("employment_types", input.employmentType);
  }
  if (input.remoteOnly) {
    params.set("work_from_home", "true");
  }

  // JSearch's current search endpoint is `/search-v2`. The old `/search`
  // path still exists for legacy subscribers but newer RapidAPI plans
  // are scoped to v2 only — calling `/search` returns a misleading
  // 403 "not subscribed to this API" from RapidAPI's gateway.
  const url = `https://${JSEARCH_HOST}/search-v2?${params.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": JSEARCH_KEY,
      "X-RapidAPI-Host": JSEARCH_HOST,
    },
  });

  if (response.status === 429) {
    throw new JsearchQuotaExceededError(
      response.headers.get("retry-after") || undefined,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new JsearchUpstreamError(
      response.status,
      `JSearch responded ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as {
    data?: { jobs?: unknown[]; cursor?: string } | unknown[];
  };

  // JSearch shape differences across versions:
  //   v1 (`/search`):     `{ data: [job1, job2, ...] }`
  //   v2 (`/search-v2`):  `{ data: { jobs: [...], cursor: "..." } }`
  // We support both so the adapter survives if JSearch flips endpoints
  // again or if a future call falls back to v1.
  const dataField = json.data;
  const rawList: unknown[] = Array.isArray(dataField)
    ? dataField
    : dataField && typeof dataField === "object"
      ? Array.isArray(dataField.jobs)
        ? dataField.jobs
        : []
      : [];
  const jobs = rawList.map(normalizeJob).filter((j) => j.id !== "");
  const byPublisher = groupByPublisher(jobs);
  return {
    jobs,
    byPublisher,
    quota: readQuotaHeaders(response.headers),
  };
}
