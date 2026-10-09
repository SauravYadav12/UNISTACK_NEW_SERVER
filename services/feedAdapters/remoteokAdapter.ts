import { fetchWithTimeout, inferUsEligibility } from "../../utils/itJobFilters";
import { FeedAdapter, NormalizedFeedJob } from "./types";

/**
 * RemoteOK — free JSON, no key. The response is an array whose FIRST element
 * is a legal/metadata object (no job fields), which must be skipped. It is a
 * fixed window of the newest ~100 posts: no search, no pagination.
 *
 * Terms are the strictest of the feeds: displaying the data requires a
 * followed backlink to the posting and crediting RemoteOK. We only store the
 * original URL in an internal review queue (the reviewer clicks through to
 * the real posting), never republish, and keep the attribution — but because
 * the terms assume public display, this feed is best left optional.
 */
const URL_ = "https://remoteok.com/api";

interface RemoteOkJob {
  id?: number | string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  date?: string;
  description?: string;
  tags?: string[];
  salary_min?: number;
  salary_max?: number;
  legal?: string; // present only on the element-0 metadata object
}

export const remoteokAdapter: FeedAdapter = {
  key: "remoteok",
  name: "RemoteOK",
  async fetchJobs(): Promise<NormalizedFeedJob[]> {
    const res = await fetchWithTimeout(URL_);
    if (!res.ok) {
      console.warn(`[feed:remoteok] responded ${res.status}`);
      return [];
    }
    const arr = (await res.json()) as RemoteOkJob[];
    if (!Array.isArray(arr)) return [];

    const out: NormalizedFeedJob[] = [];
    for (const j of arr) {
      // Skip the legal/metadata element and anything without a real posting.
      if (j.legal || !j.position || !(j.url || j.apply_url)) continue;
      const loc = String(j.location || "");
      const salary =
        j.salary_min || j.salary_max
          ? `USD ${j.salary_min || 0}-${j.salary_max || 0}/yr`
          : undefined;
      out.push({
        id: String(j.id || j.slug || j.url),
        sourceName: "RemoteOK",
        title: String(j.position || ""),
        company: String(j.company || ""),
        location: loc,
        applyUrl: String(j.url || j.apply_url),
        description: String(j.description || ""),
        postedAt: String(j.date || ""),
        salary,
        tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
        geoUS: inferUsEligibility(loc),
      });
    }
    return out;
  },
};
