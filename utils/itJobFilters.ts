/**
 * Shared helpers for the IT Job Search feed ingestion (Phase 3).
 *
 * Kept separate from the per-feed adapters so the IT keyword gate, the
 * US-eligibility inference, HTML stripping and dedupe-key logic live in one
 * place and stay consistent across Jobicy / Remotive / WWR / RemoteOK.
 */

/** Decode the common + numeric HTML entities feeds embed (e.g. `&#038;`). */
export function decodeEntities(s?: string): string {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/** Strip HTML to plain text (feeds deliver HTML descriptions). */
export function stripHtml(html?: string): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Lightweight IT gate used BEFORE spending a Claude call — same spirit as
// the JSearch sweep. A negative word in the TITLE drops the row outright;
// otherwise we require at least one positive signal in title/description.
const IT_POSITIVE = [
  "develop", "engineer", "software", "programmer", "java", "python",
  "javascript", "typescript", "react", "angular", "vue", "node", ".net",
  "c#", "golang", "rust", "devops", "sre", "cloud", "aws", "azure", "gcp",
  "kubernetes", "docker", "data engineer", "data scientist",
  "machine learning", " ml ", " ai ", "qa", "sdet", "test automation",
  "architect", "full stack", "fullstack", "backend", "frontend",
  "front end", "back end", "database", "dba", "sql", "security", "cyber",
  "network", "salesforce", "sap", "oracle", "etl", "api", "mobile", "ios",
  "android", "information technology", "scrum master", "business analyst",
  "systems analyst", "ui/ux", "platform", "infrastructure",
];
const IT_NEGATIVE_TITLE = [
  "nurse", "driver", "warehouse", "retail", "cashier", "waiter", "cook",
  "chef", "janitor", "cleaner", "teacher", "caregiver", "therapist",
  "physician", "dental", "pharmacist", "accountant", "bookkeeper",
  "receptionist", "insurance agent", "real estate", "mechanic",
  "electrician", "welder", "plumber", "security guard", "truck",
];

export function looksTechnical(title: string, description: string): boolean {
  const t = (title || "").toLowerCase();
  if (IT_NEGATIVE_TITLE.some((n) => t.includes(n))) return false;
  const haystack = `${t} ${(description || "").slice(0, 800).toLowerCase()}`;
  return IT_POSITIVE.some((p) => haystack.includes(p));
}

// Non-US region tokens used to hard-drop when a feed exposes geo and it is
// clearly another region with no US eligibility.
const NON_US_TOKENS = [
  "europe", "emea", "apac", "latam", "united kingdom", "u.k", "uk only",
  "india", "germany", "france", "spain", "poland", "netherlands", "canada",
  "australia", "singapore", "brazil", "argentina", "mexico", "philippines",
  "ukraine", "romania", "portugal", "ireland", "nigeria", "pakistan",
  "africa", "asia", "eu only", "gmt", "cet", "ist",
];
const US_TOKENS = [
  "usa", "u.s", "united states", "us only", "us-only", "us based",
  "us-based", "america", "north america", "americas",
];
const GLOBAL_TOKENS = ["worldwide", "anywhere", "global", "remote"];

/**
 * Infer US work eligibility from a feed's free-text location/region.
 *   true  → US-eligible (US token, or global/anywhere which includes the US)
 *   false → clearly another region with no US eligibility → hard-drop
 *   null  → unknown → keep, let the classifier + reviewer decide
 */
export function inferUsEligibility(text?: string): boolean | null {
  const s = (text || "").toLowerCase().trim();
  if (!s) return null;
  if (US_TOKENS.some((t) => s.includes(t))) return true;
  const nonUs = NON_US_TOKENS.some((t) => s.includes(t));
  const global = GLOBAL_TOKENS.some((t) => s.includes(t));
  if (nonUs && !global) return false;
  if (global) return true;
  return null;
}

export function normalizeKey(s?: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/** Dedupe basis title|company — matches the email/JSearch key shape. */
export function buildFeedDedupeKey(
  title: string,
  company: string,
  fallbackId: string
): string {
  const t = normalizeKey(title);
  const c = normalizeKey(company);
  const basis = [t, c].filter(Boolean).join("|");
  return t ? basis : `feed:${normalizeKey(fallbackId) || Date.now()}`;
}

/** fetch with an abort-timeout — feeds are external and occasionally hang. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "UnistackBot/1.0 (+internal IT Job Search; contact admin)",
        Accept: "application/json, text/xml, application/xml, */*",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
