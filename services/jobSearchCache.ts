/**
 * Shared cache for job-search responses.
 *
 * The cache key is a sha256 of a *normalized* representation of the
 * search parameters. Normalization (whitespace trim, lower-case keyword,
 * canonical location, sorted JSON keys) is what makes
 *   "React Developer" / "California"  and
 *   "react developer  " / "California"
 * collide on the same row — so two marketers running the "same" search
 * burn at most one upstream call between them.
 *
 * Default TTL: 6 hours. Configurable via `JOB_SEARCH_CACHE_TTL_SEC`.
 *
 * Race protection: two simultaneous misses for the same key both call
 * upstream once and both `upsert` the row. The second write overwrites
 * with identical data — harmless. We deliberately skip a distributed
 * lock; the failure mode is "one wasted upstream call", not data
 * corruption.
 */

import crypto from "crypto";
import {
  JobSearchCacheModel,
  JobSearchCacheDoc,
} from "../models/jobSearchCacheModel";
import { normalizeUsLocation } from "../utils/usLocationWhitelist";

export interface SearchCacheKeyInput {
  query: string;
  location: string;
  datePosted?: string;
  employmentType?: string;
  remoteOnly?: boolean;
}

const DEFAULT_TTL_SEC = 6 * 60 * 60; // 6 hours

function readTtlSeconds(): number {
  const raw = Number(process.env.JOB_SEARCH_CACHE_TTL_SEC);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SEC;
}

/**
 * Bumped whenever the cached payload schema changes so old rows become
 * cache-misses. Cheaper than dropping the collection by hand.
 *
 *   v1: initial release (called JSearch /search)
 *   v2: switched upstream to /search-v2 (different response shape)
 *   v3: dropped pagination, search now returns ~50 jobs in one shot —
 *       old v2 rows had only ~10 jobs each and would look truncated.
 */
const CACHE_KEY_VERSION = "v3";

/**
 * Build a deterministic cache key from search inputs. Two inputs that
 * mean the same thing (different spacing, case, key order) MUST produce
 * identical keys.
 */
export function buildCacheKey(input: SearchCacheKeyInput): string {
  const canonical = {
    cacheVersion: CACHE_KEY_VERSION,
    datePosted: (input.datePosted || "all").toLowerCase(),
    employmentType: (input.employmentType || "").toUpperCase(),
    location: normalizeUsLocation(input.location || ""),
    query: (input.query || "").trim().toLowerCase(),
    remoteOnly: Boolean(input.remoteOnly),
  };
  const serialized = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export interface CachedSearch {
  payload: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * Look up a still-fresh cached payload for the given key. Returns null
 * on miss or expiry. We pass `expiresAt > now` as a belt to the TTL
 * index's suspenders — the index purges roughly once a minute, so a row
 * may be present-but-expired briefly between purges.
 */
export async function getCachedSearch(
  cacheKey: string,
): Promise<CachedSearch | null> {
  const now = new Date();
  const row = (await JobSearchCacheModel.findOne({
    cacheKey,
    expiresAt: { $gt: now },
  }).lean()) as JobSearchCacheDoc | null;
  if (!row) return null;
  return {
    payload: row.payload,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  };
}

export interface SaveCacheInput {
  cacheKey: string;
  query: string;
  location: string;
  filters: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Write a fresh payload to the cache (or overwrite an existing row for
 * the same key). Always sets a new `expiresAt` so a force-refresh keeps
 * the row alive for another full TTL.
 */
export async function saveSearchToCache(
  input: SaveCacheInput,
): Promise<CachedSearch> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + readTtlSeconds() * 1000);
  await JobSearchCacheModel.findOneAndUpdate(
    { cacheKey: input.cacheKey },
    {
      $set: {
        cacheKey: input.cacheKey,
        query: input.query,
        location: input.location,
        filters: input.filters,
        payload: input.payload,
        fetchedAt: now,
        expiresAt,
      },
    },
    { upsert: true, new: true },
  );
  return { payload: input.payload, fetchedAt: now, expiresAt };
}
