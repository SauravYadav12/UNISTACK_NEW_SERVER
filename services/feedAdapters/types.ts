/**
 * Common shape every feed adapter normalizes to, plus the adapter contract.
 * The feed ingest service only ever sees NormalizedFeedJob — adding a new
 * feed means adding one adapter, no change to the ingest engine.
 */
export interface NormalizedFeedJob {
  id: string; // stable id from the feed (dedupe + traceability)
  sourceName: string; // "Jobicy" | "Remotive" | "We Work Remotely" | "RemoteOK"
  title: string;
  company: string;
  location: string; // free text the feed gave
  applyUrl: string; // ORIGINAL posting URL — mandatory; attribution preserved
  description: string; // may be HTML; ingest strips it
  postedAt: string; // date string (any parseable form) or ""
  salary?: string;
  tags?: string[];
  /**
   * US work eligibility if the feed exposes it:
   *   true  → US-eligible, false → clearly non-US, null → unknown.
   * Drives the "hard-drop where the feed exposes geo" rule.
   */
  geoUS: boolean | null;
}

export interface FeedAdapter {
  key: string; // config token, e.g. "jobicy"
  name: string; // display name used as sourceName
  fetchJobs(): Promise<NormalizedFeedJob[]>;
}
