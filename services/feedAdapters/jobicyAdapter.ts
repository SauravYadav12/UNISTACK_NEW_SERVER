import ENV_VARS from "../../config/env.config";
import { fetchWithTimeout } from "../../utils/itJobFilters";
import { FeedAdapter, NormalizedFeedJob } from "./types";

/**
 * Jobicy — free JSON API, no key. The `geo=usa` parameter filters by
 * applicant eligibility (who can apply, not where the employer sits), which
 * is exactly the US-remote target, so everything it returns is treated as
 * US-eligible. Docs: https://jobicy.com/jobs-rss-feed  (JSON at /api/v2).
 */
const BASE = "https://jobicy.com/api/v2/remote-jobs";

function industries(): string[] {
  const raw = ENV_VARS.IT_JOB_FEEDS_JOBICY_INDUSTRIES;
  if (typeof raw === "string" && raw.trim()) {
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return ["engineering", "data-science"];
}

interface JobicyJob {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobLevel?: string;
  jobType?: string | string[];
  jobIndustry?: string | string[];
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number | string;
  salaryMax?: number | string;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

function salaryOf(j: JobicyJob): string | undefined {
  const min = Number(j.salaryMin);
  const max = Number(j.salaryMax);
  const cur = (j.salaryCurrency || "USD").toUpperCase();
  const per = j.salaryPeriod ? `/${j.salaryPeriod}` : "";
  if (Number.isFinite(min) && Number.isFinite(max) && (min || max)) {
    return `${cur} ${min}-${max}${per}`;
  }
  const one = Number.isFinite(min) && min ? min : Number.isFinite(max) ? max : NaN;
  return Number.isFinite(one) && one ? `${cur} ${one}${per}` : undefined;
}

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

export const jobicyAdapter: FeedAdapter = {
  key: "jobicy",
  name: "Jobicy",
  async fetchJobs(): Promise<NormalizedFeedJob[]> {
    const out: NormalizedFeedJob[] = [];
    for (const industry of industries()) {
      const url = `${BASE}?count=100&geo=usa&industry=${encodeURIComponent(
        industry
      )}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        console.warn(`[feed:jobicy] ${industry} responded ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { jobs?: JobicyJob[] };
      for (const j of json.jobs || []) {
        if (!j.url) continue;
        out.push({
          id: String(j.id || j.url),
          sourceName: "Jobicy",
          title: String(j.jobTitle || ""),
          company: String(j.companyName || ""),
          location: String(j.jobGeo || "USA"),
          applyUrl: String(j.url),
          description: String(j.jobDescription || j.jobExcerpt || ""),
          postedAt: String(j.pubDate || ""),
          salary: salaryOf(j),
          tags: [
            ...toArray(j.jobIndustry),
            ...toArray(j.jobType),
            ...(j.jobLevel ? [String(j.jobLevel)] : []),
          ],
          // Requested with geo=usa → US-eligible by construction.
          geoUS: true,
        });
      }
    }
    return out;
  },
};
