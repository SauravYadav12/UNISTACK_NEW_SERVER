import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import ENV_VARS from "../config/env.config";
import { WorkAuth } from "../models/sourcedJobModel";

/**
 * Lightweight classifier for sourced jobs. Answers the three questions the
 * IT Job Search queue filters on — is it 100% remote (US-wide), is it a
 * technical/IT role, and does it look open to US citizens / green-card
 * holders (i.e. no sponsorship required) — plus a confidence score.
 *
 * Kept separate from requirementExtractionService (which fills the
 * Requirement fields) so each prompt stays focused. Defaults to the
 * cheaper CLASSIFIER_MODEL when set, else the extraction model.
 */

const CLASSIFIER_MODEL =
  (typeof ENV_VARS.CLASSIFIER_MODEL === "string" &&
  ENV_VARS.CLASSIFIER_MODEL.trim()
    ? ENV_VARS.CLASSIFIER_MODEL.trim()
    : null) ||
  (typeof ENV_VARS.CLAUDE_MODEL === "string" && ENV_VARS.CLAUDE_MODEL.trim()
    ? ENV_VARS.CLAUDE_MODEL.trim()
    : null) ||
  "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You classify a single US IT job posting. Respond with ONE JSON object only — no prose, no markdown fences.

Keys (all required):
- is100Remote (boolean): true ONLY if the role is fully/100% remote. false for hybrid, on-site, or "remote but must be in <city/state>".
- remoteScopeUS (boolean): true if remote work is allowed from anywhere in the United States (not restricted to one state/metro).
- isTechnical (boolean): true if it is a technical/IT role (software, data, cloud, devops, QA, security, IT infra, etc.).
- workAuth (string): one of "usc-gc-ok" (explicitly open to US citizens / green card holders, or explicitly "no sponsorship"), "needs-sponsorship" (mentions H1B/OPT/CPT sponsorship or visa transfer as the target), or "unknown" (not stated).
- seniority (string): e.g. "Junior", "Mid", "Senior", "Lead", or "" if unclear.
- confidence (number): 0 to 1, your overall confidence in these classifications.`;

const resultSchema = z.object({
  is100Remote: z.boolean().optional().default(false),
  remoteScopeUS: z.boolean().optional().default(false),
  isTechnical: z.boolean().optional().default(false),
  workAuth: z
    .enum(["usc-gc-ok", "needs-sponsorship", "unknown"])
    .optional()
    .default("unknown"),
  seniority: z.string().optional().default(""),
  confidence: z.number().min(0).max(1).optional().default(0),
});

export interface JobClassification {
  is100Remote: boolean;
  remoteScopeUS: boolean;
  isTechnical: boolean;
  workAuth: WorkAuth;
  seniority: string;
  confidence: number;
  classifierModel: string;
}

export interface ClassifyJobInput {
  jobTitle?: string;
  jobDescription?: string;
  remote?: string[];
  location?: string;
  rawText?: string;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return JSON.parse(fence ? fence[1].trim() : trimmed);
}

/**
 * Returns a classification. On any failure it degrades gracefully to a
 * conservative "unknown / low-confidence" result rather than throwing, so
 * one bad row never breaks a whole ingestion run — the reviewer still sees
 * the job in the queue.
 */
export async function classifyJob(
  input: ClassifyJobInput
): Promise<JobClassification> {
  const fallback: JobClassification = {
    is100Remote: false,
    remoteScopeUS: false,
    isTechnical: false,
    workAuth: "unknown",
    seniority: "",
    confidence: 0,
    classifierModel: CLASSIFIER_MODEL,
  };

  const apiKey = ENV_VARS.CLAUDE_API_KEY;
  if (!apiKey || typeof apiKey !== "string") return fallback;

  const userText = [
    input.jobTitle ? `Title: ${input.jobTitle}` : "",
    input.location ? `Location: ${input.location}` : "",
    input.remote && input.remote.length
      ? `Remote notes: ${input.remote.join(", ")}`
      : "",
    "\nDescription / source text:\n",
    (input.jobDescription || input.rawText || "").slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return fallback;
    const parsed = resultSchema.safeParse(parseJson(block.text));
    if (!parsed.success) return fallback;
    return { ...parsed.data, classifierModel: CLASSIFIER_MODEL };
  } catch (e) {
    console.warn(
      "[jobClassifier] classification failed, using fallback:",
      (e as Error).message
    );
    return fallback;
  }
}
