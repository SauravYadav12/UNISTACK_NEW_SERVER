import { Request, Response } from "express";
import { UserDoc } from "../models/userModel";
import { isValidUsLocation, normalizeUsLocation } from "../utils/usLocationWhitelist";
import {
  searchJobsOnJsearch,
  JsearchQuotaExceededError,
  JsearchUpstreamError,
  JsearchConfigError,
  JsearchSearchInput,
} from "../services/jsearchClient";
import {
  buildCacheKey,
  getCachedSearch,
  saveSearchToCache,
} from "../services/jobSearchCache";

const ALLOWED_DATE_POSTED = ["all", "today", "3days", "week", "month"] as const;
const ALLOWED_EMPLOYMENT_TYPES = [
  "FULLTIME",
  "CONTRACTOR",
  "PARTTIME",
  "INTERN",
] as const;

type DatePosted = (typeof ALLOWED_DATE_POSTED)[number];
type EmploymentType = (typeof ALLOWED_EMPLOYMENT_TYPES)[number];

interface SearchRequestBody {
  query?: unknown;
  location?: unknown;
  datePosted?: unknown;
  employmentType?: unknown;
  remoteOnly?: unknown;
  forceRefresh?: unknown;
}

interface ValidatedInput {
  query: string;
  location: string;
  datePosted: DatePosted;
  employmentType?: EmploymentType;
  remoteOnly: boolean;
  forceRefresh: boolean;
}

function parseInput(body: SearchRequestBody): {
  input?: ValidatedInput;
  error?: string;
} {
  const query = String(body.query || "").trim();
  if (!query) return { error: "`query` is required." };
  if (query.length > 120) return { error: "`query` is too long." };

  const rawLocation = String(body.location || "").trim();
  if (!isValidUsLocation(rawLocation)) {
    return {
      error:
        "Location must be a US state, US city (e.g. 'Austin, TX'), or 'Remote'.",
    };
  }
  const location = normalizeUsLocation(rawLocation);

  const rawDatePosted = String(body.datePosted || "all");
  const datePosted = (ALLOWED_DATE_POSTED as readonly string[]).includes(
    rawDatePosted,
  )
    ? (rawDatePosted as DatePosted)
    : "all";

  let employmentType: EmploymentType | undefined;
  if (body.employmentType) {
    const raw = String(body.employmentType);
    if (!(ALLOWED_EMPLOYMENT_TYPES as readonly string[]).includes(raw)) {
      return { error: "`employmentType` is not a recognized value." };
    }
    employmentType = raw as EmploymentType;
  }

  const remoteOnly = Boolean(body.remoteOnly);
  const forceRefresh = Boolean(body.forceRefresh);

  return {
    input: {
      query,
      location,
      datePosted,
      employmentType,
      remoteOnly,
      forceRefresh,
    },
  };
}

function logSearch(
  user: UserDoc | undefined,
  input: ValidatedInput,
  source: "cache" | "jsearch",
  resultCount: number,
  quota?: { remaining?: number; limit?: number },
): void {
  console.log(
    JSON.stringify({
      kind: "job-search",
      source,
      userRef: user?._id?.toString(),
      query: input.query,
      location: input.location,
      datePosted: input.datePosted,
      employmentType: input.employmentType,
      remoteOnly: input.remoteOnly,
      resultCount,
      quotaRemaining: quota?.remaining,
      quotaLimit: quota?.limit,
      at: new Date().toISOString(),
    }),
  );
}

export const searchJobs = async (req: Request, res: Response): Promise<void> => {
  const { input, error } = parseInput(req.body || {});
  if (!input) {
    res.status(400).json({ error });
    return;
  }

  const user = req.user as UserDoc | undefined;
  const cacheKey = buildCacheKey({
    query: input.query,
    location: input.location,
    datePosted: input.datePosted,
    employmentType: input.employmentType,
    remoteOnly: input.remoteOnly,
  });

  // Cache-first read. Skipped only when the caller explicitly asks to
  // bypass it (admin "force refresh" affordance on the client).
  if (!input.forceRefresh) {
    try {
      const hit = await getCachedSearch(cacheKey);
      if (hit) {
        const payload = hit.payload as {
          jobs?: unknown[];
        };
        logSearch(
          user,
          input,
          "cache",
          Array.isArray(payload.jobs) ? payload.jobs.length : 0,
        );
        res.status(200).json({
          ...hit.payload,
          fromCache: true,
          fetchedAt: hit.fetchedAt.toISOString(),
        });
        return;
      }
    } catch (cacheErr) {
      // A cache read failure shouldn't break search — log and fall
      // through to the live upstream call.
      console.error("job-search cache read failed:", cacheErr);
    }
  }

  // Cache miss (or forced refresh) — call JSearch.
  try {
    const jsearchInput: JsearchSearchInput = {
      query: input.query,
      location: input.location,
      datePosted: input.datePosted,
      employmentType: input.employmentType,
      remoteOnly: input.remoteOnly,
    };
    const result = await searchJobsOnJsearch(jsearchInput);
    const now = new Date();
    const payload = {
      jobs: result.jobs,
      byPublisher: result.byPublisher,
      quota: result.quota,
      fetchedAt: now.toISOString(),
      fromCache: false,
    };

    // Write to cache best-effort — a failure here shouldn't deny the
    // user their already-paid-for response.
    try {
      await saveSearchToCache({
        cacheKey,
        query: input.query,
        location: input.location,
        filters: {
          datePosted: input.datePosted,
          employmentType: input.employmentType,
          remoteOnly: input.remoteOnly,
        },
        payload,
      });
    } catch (saveErr) {
      console.error("job-search cache save failed:", saveErr);
    }

    logSearch(user, input, "jsearch", result.jobs.length, result.quota);
    res.status(200).json(payload);
    return;
  } catch (err) {
    if (err instanceof JsearchQuotaExceededError) {
      console.warn("job-search quota exceeded", {
        userRef: user?._id?.toString(),
        retryAfter: err.retryAfter,
      });
      res.status(200).json({
        jobs: [],
        byPublisher: {},
        quota: { remaining: 0 },
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        quotaExceeded: true,
        retryAfter: err.retryAfter,
      });
      return;
    }
    if (err instanceof JsearchConfigError) {
      console.error("job-search config error:", err.message);
      res.status(503).json({
        error: err.message,
      });
      return;
    }
    if (err instanceof JsearchUpstreamError) {
      console.error(
        `job-search upstream error (status=${err.status}):`,
        err.message,
      );
      res.status(502).json({
        error: `Upstream job search provider returned ${err.status}. ${err.message.slice(0, 200)}`,
      });
      return;
    }
    console.error("job-search unexpected error:", err);
    res.status(500).json({ error: "Job search failed." });
    return;
  }
};
