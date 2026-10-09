import { XMLParser } from "fast-xml-parser";
import ENV_VARS from "../../config/env.config";
import { fetchWithTimeout, inferUsEligibility } from "../../utils/itJobFilters";
import { FeedAdapter, NormalizedFeedJob } from "./types";

/**
 * We Work Remotely — RSS (XML), no key. We pull the programming category.
 * Titles come as "Company: Role", which we split. No reliable US field, so
 * eligibility is inferred from the <region> element when present, else
 * left unknown. Terms: attribute links back to WWR (we keep the link).
 */
const BASE = "https://weworkremotely.com/categories";

function feedSlugs(): string[] {
  const raw = ENV_VARS.IT_JOB_FEEDS_WWR_FEEDS;
  if (typeof raw === "string" && raw.trim()) {
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return ["remote-programming-jobs"];
}

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text"?: string };
  region?: string;
  type?: string;
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] || "");
  }
  return String(v);
}

function splitCompanyRole(title: string): { company: string; role: string } {
  const idx = title.indexOf(":");
  if (idx > 0) {
    return {
      company: title.slice(0, idx).trim(),
      role: title.slice(idx + 1).trim(),
    };
  }
  return { company: "", role: title.trim() };
}

export const weworkremotelyAdapter: FeedAdapter = {
  key: "weworkremotely",
  name: "We Work Remotely",
  async fetchJobs(): Promise<NormalizedFeedJob[]> {
    const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
    const out: NormalizedFeedJob[] = [];
    for (const slug of feedSlugs()) {
      const url = `${BASE}/${slug}.rss`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        console.warn(`[feed:wwr] ${slug} responded ${res.status}`);
        continue;
      }
      const xml = await res.text();
      let parsed: { rss?: { channel?: { item?: RssItem | RssItem[] } } };
      try {
        parsed = parser.parse(xml);
      } catch (e) {
        console.warn(`[feed:wwr] ${slug} parse failed:`, (e as Error).message);
        continue;
      }
      const rawItems = parsed?.rss?.channel?.item;
      const items: RssItem[] = Array.isArray(rawItems)
        ? rawItems
        : rawItems
          ? [rawItems]
          : [];
      for (const it of items) {
        const link = textOf(it.link);
        if (!link) continue;
        const { company, role } = splitCompanyRole(textOf(it.title));
        const region = textOf(it.region);
        out.push({
          id: textOf(it.guid) || link,
          sourceName: "We Work Remotely",
          title: role,
          company,
          location: region,
          applyUrl: link,
          description: textOf(it.description),
          postedAt: textOf(it.pubDate),
          tags: it.type ? [textOf(it.type)] : [],
          geoUS: inferUsEligibility(region),
        });
      }
    }
    return out;
  },
};
