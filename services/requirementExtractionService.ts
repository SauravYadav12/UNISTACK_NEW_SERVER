import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import ENV_VARS from "../config/env.config";




const DEFAULT_CLAUDE_MODEL =
  (typeof ENV_VARS.CLAUDE_MODEL === "string" && ENV_VARS.CLAUDE_MODEL.trim()
    ? ENV_VARS.CLAUDE_MODEL.trim()
    : null) || "claude-sonnet-4-20250514";

/**
 * String extractable fields: each object key is the JSON field name; value is the prompt hint.
 * (reqID, status, assignment, resume paths, audit, duplicate flags, etc. stay app-internal.)
 */
export const REQUIREMENT_STRING_FIELD_HINTS = {
  clientCompany: "End client / hiring company name.",
  clientWebsite: "Client company website URL if stated.",
  clientAddress: "Client location or address if stated.",
  clientPerson: "Primary contact name at the client.",
  clientPhone: "Client contact phone (as text).",
  clientEmail: "Client contact email.",
  primeVendorCompany: "Prime vendor / middle-layer company if mentioned.",
  primeVendorWebsite: "Prime vendor website if stated.",
  primeVendorName: "Prime vendor contact person if stated.",
  primeVendorPhone: "Prime vendor phone.",
  primeVendorEmail: "Prime vendor email.",
  vendorCompany: "Direct vendor or agency name if different from prime.",
  vendorWebsite: "Vendor website if stated.",
  vendorPersonName: "Vendor-side contact name.",
  vendorPhone: "Vendor phone.",
  vendorEmail: "Vendor email.",
  jobTitle: "Role or position title.",
  employementType:
    "Engagement type if stated (W2, C2C, 1099, full-time, etc.). Use the exact field name employementType.",
  jobPortalLink: "URL to the job posting or portal link if present.",
  reqKeywords: "Short skill or keyword summary as a single string (e.g. comma-separated).",
  jobDescription: "Job description or scope text from the source. If not present, provide a brief summary of the job requirements. and formate in list of items.",
  recordOwner: "Recruiter or record owner name if implied.",
  primaryTech: "Primary technology or stack focus.",
  secondaryTech: "Secondary tools or technologies.",
  primaryTechStack: "Broader stack summary if distinct from primary/secondary.",
} as const;

/**
 * Array extractable fields: key = field name, value = hint. Normalized to string[];
 * JSON numbers in arrays are coerced to strings.
 */
export const REQUIREMENT_ARRAY_FIELD_HINTS = {
  rate: "Pay or bill rates, one entry per distinct value (e.g. \"$85/hr\", \"100-120\").",
  taxType: "Tax-related labels if mentioned (e.g. W2, C2C).",
  remote: "Percentage of remote work if mentioned (e.g. \"50% remote\", \"100% remote\", \"Hybrid\").",
  duration: "Contract or engagement duration strings (e.g. \"6 months\", \"12 months +\" or \"Long-term\").",
} as const;



/** Field names derived from {@link REQUIREMENT_STRING_FIELD_HINTS}. */
export const REQUIREMENT_STRING_FIELDS = Object.keys(
  REQUIREMENT_STRING_FIELD_HINTS,
) as RequirementStringField[];

/** Field names derived from {@link REQUIREMENT_ARRAY_FIELD_HINTS}. */
export const REQUIREMENT_ARRAY_FIELDS = Object.keys(
  REQUIREMENT_ARRAY_FIELD_HINTS,
) as RequirementArrayField[];

export const REQUIREMENT_EXTRACTABLE_KEYS: RequirementExtractableKey[] = [
  ...REQUIREMENT_STRING_FIELDS,
  ...REQUIREMENT_ARRAY_FIELDS,
];

export class RequirementExtractionValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(details.join("; "));
    this.name = "RequirementExtractionValidationError";
  }
}


function formatFieldGuide(
  fieldHints: Readonly<Record<string, string>>,
  valueKind: "string" | "array",
): string {
  const typeLabel =
    valueKind === "string"
      ? "string"
      : "array (each item string or JSON number; stored as string; no objects or nested arrays)";
  return Object.entries(fieldHints)
    .map(([key, hint]) =>
      hint.trim()
        ? `- ${key} (${typeLabel}): ${hint}`
        : `- ${key} (${typeLabel})`,
    )
    .join("\n");
}

function buildRequirementExtractionSystemPrompt(): string {
  const allKeys = REQUIREMENT_EXTRACTABLE_KEYS.join(", ");
  const stringGuide = formatFieldGuide(REQUIREMENT_STRING_FIELD_HINTS, "string");
  const arrayGuide = formatFieldGuide(REQUIREMENT_ARRAY_FIELD_HINTS, "array");
  return `You extract structured job requirement data from unstructured text.

Output rules:
- Respond with a single JSON object only. No markdown fences, no commentary before or after the JSON.
- Extract only these keys (all optional). Do not include any other keys. Omit keys you cannot infer; prefer omitting a key over guessing.
- Map content faithfully from the source text.

String fields (JSON string when present):
${stringGuide}

Array fields (JSON array when present):
${arrayGuide}

Complete key list: ${allKeys}.`;
}

const REQUIREMENT_EXTRACTION_SYSTEM_PROMPT = buildRequirementExtractionSystemPrompt();

// ---------------------------------------------------------------------------
// Validation: Zod schema + guards (grouped for clarity)
// ---------------------------------------------------------------------------

function buildRequirementExtractedSchema() {
  const optionalString = z.preprocess(
    (v) => (v === null ? undefined : v),
    z.string().optional(),
  );

  const arrayElementAsString = z.union([
    z.string(),
    z.number().transform((n) => String(n)),
  ]);

  const optionalStringArray = z.preprocess(
    (v) => (v === null ? undefined : v),
    z.array(arrayElementAsString).optional(),
  );

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(REQUIREMENT_STRING_FIELD_HINTS)) {
    shape[key] = optionalString;
  }
  for (const key of Object.keys(REQUIREMENT_ARRAY_FIELD_HINTS)) {
    shape[key] = optionalStringArray;
  }

  return z
    .object(shape as z.ZodRawShape)
    .strict()
    .transform((data) =>
      Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      ),
    );
}

export const requirementExtractedSchema = buildRequirementExtractedSchema();


function zodIssuesToDetails(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}


function parseExtractionJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const jsonText = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new RequirementExtractionValidationError([
      "Model response was not valid JSON",
    ]);
  }
}

function parseExtractionZodResult(
  result: ReturnType<typeof requirementExtractedSchema.safeParse>,
): RequirementExtracted {
  if (!result.success) {
    throw new RequirementExtractionValidationError(
      zodIssuesToDetails(result.error),
    );
  }
  return result.data;
}

/**
 * Validates and normalizes a parsed JSON object against the requirement extraction schema.
 */
export function validateAndNormalizeRequirementExtracted(
  raw: unknown,
): RequirementExtracted {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RequirementExtractionValidationError([
      "Root value must be a JSON object",
    ]);
  }
  return parseExtractionZodResult(requirementExtractedSchema.safeParse(raw));
}

function validateExtractionApiInput(input: ExtractRequirementFromContentInput): {
  content: string;
  instruction?: string;
} {
  const { content, instruction } = input;
  if (typeof content !== "string" || !content.trim()) {
    throw new RequirementExtractionValidationError([
      'Body field "content" must be a non-empty string',
    ]);
  }
  const trimmedInstruction =
    instruction !== undefined && instruction !== null && String(instruction).trim()
      ? String(instruction).trim()
      : undefined;
  return { content: content.trim(), instruction: trimmedInstruction };
}

function extractTextFromAnthropicMessage(
  blocks: Anthropic.Messages.ContentBlock[],
): string {
  const textBlock = blocks.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new RequirementExtractionValidationError([
      "No text content in model response",
    ]);
  }
  return textBlock.text;
}


/**
 * Calls Claude to map free-form content into requirement-shaped fields,
 * then validates and normalizes the result.
 */
export async function extractRequirementFromContent(
  input: ExtractRequirementFromContentInput,
): Promise<RequirementExtracted> {
  const apiKey = ENV_VARS.CLAUDE_API_KEY;
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("CLAUDE_API_KEY is not configured");
  }

  const { content, instruction } = validateExtractionApiInput(input);

  const userParts: string[] = [
    "Source text to extract from:\n---\n",
    content,
    "\n---",
  ];
  if (instruction) {
    userParts.push("\n\nAdditional instructions:\n", instruction);
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 8192,
    system: REQUIREMENT_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userParts.join(""),
      },
    ],
  });

  const modelText = extractTextFromAnthropicMessage(message.content);
  const parsed = parseExtractionJsonFromModelText(modelText);
  return validateAndNormalizeRequirementExtracted(parsed);
}


export type RequirementExtracted = z.output<typeof requirementExtractedSchema>;
export interface ExtractRequirementFromContentInput {
  content: string;
  instruction?: string;
}export type RequirementStringField = keyof typeof REQUIREMENT_STRING_FIELD_HINTS;
export type RequirementArrayField = keyof typeof REQUIREMENT_ARRAY_FIELD_HINTS;
export type RequirementExtractableKey =
  RequirementStringField | RequirementArrayField;
