/**
 * Normalizes the JSearch upstream JSON into the shape the client renders.
 *
 * JSearch's response wraps a list of jobs, each with provider-specific
 * fields. The client only cares about a stable subset (title, company,
 * location, salary, posted date, apply link, description, publisher).
 *
 * Two responsibilities live here:
 *   1. Map each upstream item → `NormalizedJob`.
 *   2. Canonicalize the `publisher` string so "LinkedIn" and "LinkedIn.com"
 *      and "Linkedin" all bucket together in the per-board card grid.
 */

export type Publisher =
  | "Indeed"
  | "LinkedIn"
  | "ZipRecruiter"
  | "Glassdoor"
  | "Dice"
  | "Monster"
  | "Other";

export interface NormalizedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  publisher: Publisher;
  /** Where to apply — opens in a new tab on the client. */
  applyUrl: string;
  /** ISO timestamp when the posting was published, or "" if unknown. */
  postedAt: string;
  employmentType: string;
  /** Best-effort human-readable salary string ("$120k - $150k / year"). */
  salary: string;
  description: string;
  isRemote: boolean;
}

const PUBLISHER_MAP: { needles: string[]; canonical: Publisher }[] = [
  { needles: ["indeed"], canonical: "Indeed" },
  { needles: ["linkedin"], canonical: "LinkedIn" },
  { needles: ["ziprecruiter", "zip recruiter"], canonical: "ZipRecruiter" },
  { needles: ["glassdoor"], canonical: "Glassdoor" },
  { needles: ["dice"], canonical: "Dice" },
  { needles: ["monster"], canonical: "Monster" },
];

export function canonicalizePublisher(raw: string): Publisher {
  const value = (raw || "").toLowerCase();
  if (!value) return "Other";
  for (const entry of PUBLISHER_MAP) {
    if (entry.needles.some((n) => value.includes(n))) return entry.canonical;
  }
  return "Other";
}

function formatSalary(job: Record<string, unknown>): string {
  const min = Number(job.job_min_salary);
  const max = Number(job.job_max_salary);
  const period = String(job.job_salary_period || "").toLowerCase();
  if (!Number.isFinite(min) && !Number.isFinite(max)) return "";

  const periodLabel =
    period === "year"
      ? "/ year"
      : period === "month"
        ? "/ month"
        : period === "hour"
          ? "/ hour"
          : "";

  const fmt = (n: number) =>
    n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

  if (Number.isFinite(min) && Number.isFinite(max) && min !== max) {
    return `${fmt(min)} - ${fmt(max)} ${periodLabel}`.trim();
  }
  const single = Number.isFinite(min) ? min : max;
  return `${fmt(single)} ${periodLabel}`.trim();
}

function buildLocation(job: Record<string, unknown>): string {
  const city = String(job.job_city || "").trim();
  const state = String(job.job_state || "").trim();
  const country = String(job.job_country || "").trim();

  if (job.job_is_remote) {
    if (state) return `Remote · ${state}`;
    return "Remote";
  }
  const parts = [city, state, country].filter((p) => p.length > 0);
  return parts.join(", ");
}

/**
 * Map one raw JSearch job item into the normalized shape.
 *
 * Defensive: every field is given a safe default so a missing key from
 * the upstream never crashes the controller.
 */
export function normalizeJob(raw: unknown): NormalizedJob {
  const job = (raw || {}) as Record<string, unknown>;
  return {
    id: String(job.job_id || ""),
    title: String(job.job_title || ""),
    company: String(job.employer_name || ""),
    location: buildLocation(job),
    publisher: canonicalizePublisher(String(job.job_publisher || "")),
    applyUrl: String(job.job_apply_link || job.job_google_link || ""),
    postedAt: String(job.job_posted_at_datetime_utc || ""),
    employmentType: String(job.job_employment_type || ""),
    salary: formatSalary(job),
    description: String(job.job_description || ""),
    isRemote: Boolean(job.job_is_remote),
  };
}

/**
 * Build the per-publisher index the client uses to render one card per
 * board. Stable insertion order — Indeed first if present, then LinkedIn,
 * etc., based on encounter order in the upstream list.
 */
export function groupByPublisher(
  jobs: NormalizedJob[],
): Record<string, NormalizedJob[]> {
  const groups: Record<string, NormalizedJob[]> = {};
  for (const job of jobs) {
    const key = job.publisher;
    if (!groups[key]) groups[key] = [];
    groups[key].push(job);
  }
  return groups;
}
