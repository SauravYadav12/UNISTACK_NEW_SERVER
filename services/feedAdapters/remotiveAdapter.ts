import ENV_VARS from "../../config/env.config";
import { fetchWithTimeout, inferUsEligibility } from "../../utils/itJobFilters";
import { FeedAdapter, NormalizedFeedJob } from "./types";

/**
 * Remotive — free JSON API, no key. We pull the IT categories only. No
 * built-in US filter, so eligibility is inferred from
 * `candidate_required_location` (e.g. "USA Only", "Worldwide", "Europe").
 * Terms: link back + credit Remotive (we keep the original URL), fetch at
 * most a few times/day, listings are ~24h delayed.
 */
const BASE = "https://remotive.com/api/remote-jobs";

function categories(): string[] {
  const raw = ENV_VARS.IT_JOB_FEEDS_REMOTIVE_CATEGORIES;
  if (typeof raw === "string" && raw.trim()) {
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return ["software-dev"];
}

interface RemotiveJob {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  publication_date?: string;
  salary?: string;
  job_type?: string;
  tags?: string[];
  description?: string;
}

export const remotiveAdapter: FeedAdapter = {
  key: "remotive",
  name: "Remotive",
  async fetchJobs(): Promise<NormalizedFeedJob[]> {
    const out: NormalizedFeedJob[] = [];
    for (const category of categories()) {
      const url = `${BASE}?category=${encodeURIComponent(category)}&limit=100`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        console.warn(`[feed:remotive] ${category} responded ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { jobs?: RemotiveJob[] };
      for (const j of json.jobs || []) {
        if (!j.url) continue;
        const loc = String(j.candidate_required_location || "");
        out.push({
          id: String(j.id || j.url),
          sourceName: "Remotive",
          title: String(j.title || ""),
          company: String(j.company_name || ""),
          location: loc,
          applyUrl: String(j.url),
          description: String(j.description || ""),
          postedAt: String(j.publication_date || ""),
          salary: j.salary ? String(j.salary) : undefined,
          tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
          geoUS: inferUsEligibility(loc),
        });
      }
    }
    return out;
  },
};
