/**
 * AI-driven canonicaliser for text values that appear in the Employee
 * Pulse trend chart (job titles, primary/secondary tech, tech stack,
 * client company). Merges seniority + spelling variants under one
 * canonical name so the chart shows one line per real position type
 * instead of one line per phrasing.
 *
 * Cache-first: the JobTitleCanonical collection stores every (raw,
 * groupType) → canonical mapping we've ever seen. Only cache-misses
 * hit the Claude API, and results are upserted back so the next run
 * is a pure DB read.
 *
 * On API failure or missing CLAUDE_API_KEY the resolver falls back to
 * returning raws unchanged — the chart still renders, just without the
 * merging.
 */
import Anthropic from "@anthropic-ai/sdk";

import ENV_VARS from "../config/env.config";
import { JobTitleCanonicalModel } from "../models/jobTitleCanonicalModel";

const MODEL =
  (typeof ENV_VARS.CLAUDE_MODEL === "string" && ENV_VARS.CLAUDE_MODEL
    ? ENV_VARS.CLAUDE_MODEL
    : null) || "claude-sonnet-4-20250514";

/** Max raws sent to Claude per API call. Keeps token usage predictable. */
const BATCH_SIZE = 60;

/**
 * In-process guard so we don't fire the Claude API more than once for
 * the same (raw, groupType) pair even if two overlapping requests both
 * see a cache miss. Cleared as soon as the API call completes and the
 * cache is written.
 */
const inFlight = new Set<string>();

export type CanonicalGroupType =
  | "jobTitle"
  | "primaryTech"
  | "secondaryTech"
  | "primaryTechStack"
  | "clientCompany";

/**
 * Given a list of raw strings, return a Map keyed by the lower-cased +
 * trimmed raw → canonical form.
 *
 * Cache-only on the request path — never blocks on Claude. Cache-miss
 * raws are returned unchanged AND a background Claude call is kicked
 * off (fire-and-forget) so the cache is warm for the next request.
 *
 * Trade-off: the first-ever request for a given title shows the raw
 * string; the next request after ~2-5s shows the canonical form. Any
 * request that returns unchanged raws will still render the chart
 * correctly — variants just won't be merged for that one render.
 */
export async function resolveTitles(
  raws: string[],
  groupType: CanonicalGroupType,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  const cleaned = new Set<string>();
  for (const r of raws) {
    const c = String(r || "").trim().toLowerCase();
    if (c) cleaned.add(c);
  }
  if (cleaned.size === 0) return out;

  const list = Array.from(cleaned);

  // ── Cache lookup (blocking, indexed — fast). ──
  const cached = await JobTitleCanonicalModel.find({
    groupType,
    raw: { $in: list },
  })
    .select("raw canonical")
    .lean();
  const cachedSet = new Set<string>();
  for (const c of cached) {
    out.set(c.raw, c.canonical);
    cachedSet.add(c.raw);
  }

  // ── Cache miss: fill with raws + kick off background warm. ──
  const missing = list.filter((r) => !cachedSet.has(r));
  for (const r of missing) out.set(r, r);
  if (missing.length > 0) warmInBackground(missing, groupType);
  return out;
}

/**
 * Fires the Claude → cache pipeline out-of-band. Never awaited. Uses
 * an in-process guard so overlapping requests don't stack duplicate
 * API calls for the same raw+groupType.
 */
function warmInBackground(missing: string[], groupType: CanonicalGroupType): void {
  const apiKey = ENV_VARS.CLAUDE_API_KEY;
  if (!apiKey) return;

  const todo = missing.filter((r) => {
    const key = `${groupType}::${r}`;
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    return true;
  });
  if (todo.length === 0) return;

  // Detach: no await from any caller.
  void (async () => {
    try {
      const client = new Anthropic({ apiKey });
      const groups = chunk(todo, BATCH_SIZE);
      for (const batch of groups) {
        try {
          const map = await canonicaliseBatch(client, batch, groupType);
          if (map.size === 0) continue;
          const inserts: Array<{
            updateOne: {
              filter: { raw: string; groupType: string };
              update: { $set: Record<string, string> };
              upsert: true;
            };
          }> = [];
          for (const [raw, canonical] of map.entries()) {
            inserts.push({
              updateOne: {
                filter: { raw, groupType },
                update: { $set: { raw, canonical, groupType } },
                upsert: true,
              },
            });
          }
          await JobTitleCanonicalModel.bulkWrite(inserts, { ordered: false });
        } catch {
          // Swallow batch errors — next request will retry this batch.
        }
      }
    } finally {
      for (const r of todo) inFlight.delete(`${groupType}::${r}`);
    }
  })();
}

async function canonicaliseBatch(
  client: Anthropic,
  batch: string[],
  groupType: CanonicalGroupType,
): Promise<Map<string, string>> {
  const isTech =
    groupType === "primaryTech" ||
    groupType === "secondaryTech" ||
    groupType === "primaryTechStack";
  const isCompany = groupType === "clientCompany";

  const domain = isTech
    ? "technology names"
    : isCompany
      ? "company names"
      : "job titles";

  const rules = isTech
    ? [
        "Merge spelling variants under one canonical name (React / ReactJS / React.js → React; NodeJS / Node.js → Node.js; DotNet / .NET → .NET).",
        "Preserve distinct technologies (React ≠ React Native; Node.js ≠ Deno; Java ≠ JavaScript).",
        "Use the official spelling and casing (React, Node.js, PostgreSQL, MongoDB, .NET, TypeScript).",
      ]
    : isCompany
      ? [
          "Merge Inc/LLC/Corp/Ltd/Co suffix variants under the same core name (e.g. 'Acme Inc' + 'Acme Corp.' → 'Acme').",
          "Merge obvious spelling variants (case, punctuation, extra whitespace).",
          "Title case the canonical output.",
        ]
      : [
          "Merge seniority variants: 'Senior', 'Sr', 'Sr.', 'Lead', 'Principal', 'Staff', 'Junior', 'Jr', 'Jr.', 'II', 'III', 'IV' + base role → base role only.",
          "Merge role-word synonyms for the same tech: 'React Developer', 'React Engineer', 'React Programmer' → 'React Developer'. Prefer 'Developer' as the canonical noun for software roles.",
          "Preserve tech specificity: 'React Developer' ≠ 'Node.js Developer' ≠ 'Java Developer'.",
          "Strip parenthetical qualifiers like '(Remote)', '(Contract)', 'W2 only', 'USC only'.",
          "Preserve non-software job types verbatim (e.g. 'Business Analyst' stays as 'Business Analyst').",
          "Title case the canonical output.",
        ];

  const prompt = `Canonicalise the following ${domain}. Group synonymous variants under a single canonical name so a downstream chart shows one line per real ${domain.slice(0, -1)}.

Rules:
${rules.map((r) => "- " + r).join("\n")}

Input list (one per line, already lower-cased):
${batch.join("\n")}

Respond with STRICT JSON ONLY: an object mapping each input VERBATIM (lower-cased, exactly as given) to its canonical form. Do not include any prose, code fences, or commentary.

Example input:
senior react developer
sr react dev
react engineer

Example output:
{"senior react developer":"React Developer","sr react dev":"React Developer","react engineer":"React Developer"}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text",
    )
    .map((b) => b.text)
    .join("")
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON in Claude response");
  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed)) {
    const raw = String(k).trim().toLowerCase();
    const canonical = String(v || "").trim();
    if (raw && canonical) map.set(raw, canonical);
  }
  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
