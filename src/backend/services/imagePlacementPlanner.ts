/**
 * Placement planning for accessibility visual generation.
 *
 * Photo analysis runs in parallel with image generation (both are queued from
 * virusScanWorker.ts), so the edit step can't reuse its output. Instead, right
 * before the edit, one vision call looks at the photo and returns, for each
 * requested modification, a concrete placement and an approximate box for it.
 * That plan is fed into the edit prompt (and, in a later phase, a mask).
 *
 * planModificationPlacement() never throws: on any failure it returns a FAILED
 * result and the caller falls back to the static rules in
 * imageModificationPlacement.ts.
 */
import { getOpenAIClient } from "lib/openai";
import { PHOTO_ANALYSIS_MODEL_NAME } from "@/backend/services/photoAnalysisModelConfig";
import { getModificationPlacementRule } from "@/backend/services/imageModificationPlacement";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";
import type { ModificationCode } from "@/backend/eligibility/types";

// Bump whenever buildPlacementPlannerPrompt's wording or the expected JSON
// shape changes; recorded in the audit metadata next to the plan.
export const PLACEMENT_PLANNER_PROMPT_VERSION = 1 as const;

const PLANNER_TIMEOUT_MS = 60_000;

/** Normalized to the image: 0–1 from the left/top edge, width/height as fractions. */
export interface PlacementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ModificationPlacementPlanEntry {
  modificationCode: string;
  applicable: boolean;
  placement: string | null;
  box: PlacementBox | null;
  reason: string | null;
}

export interface PlacementPlan {
  visibleElements: string[];
  placements: ModificationPlacementPlanEntry[];
}

export interface PlacementPlanUsage {
  promptTokens: number;
  completionTokens: number;
}

export type PlacementPlanResult =
  | {
      status: "READY";
      plan: PlacementPlan;
      rawResponse: string;
      model: string;
      promptVersion: number;
      usage: PlacementPlanUsage | null;
    }
  | {
      status: "FAILED";
      error: string;
      rawResponse: string | null;
      model: string;
      promptVersion: number;
    };

function getModificationLabel(code: string): string {
  return MODIFICATION_COST_CATALOG[code as ModificationCode]?.label ?? code.replace(/_/g, " ");
}

export function buildPlacementPlannerPrompt(modificationCodes: string[]): string {
  const items = modificationCodes
    .map((code) => {
      const rule = getModificationPlacementRule(code);
      const guidance = rule ? ` Typical installation: ${rule.placement} ${rule.mounting}` : "";
      return `- ${code} (${getModificationLabel(code)}).${guidance}`;
    })
    .join("\n");

  return [
    "You are planning where accessibility modifications would realistically be installed in this photo of a home.",
    "",
    "Requested modifications:",
    items,
    "",
    "Return ONLY a JSON object with this shape:",
    "{",
    '  "visibleElements": string[],  // fixtures and features you can see, e.g. "toilet", "bathtub", "shower", "vanity", "stairs", "doorway", "entry steps", "floor"',
    '  "placements": [',
    "    {",
    '      "modificationCode": string,  // one of the requested codes, exactly as written above',
    '      "applicable": boolean,       // false if this photo has nowhere realistic to install it (e.g. stair lift with no stairs visible)',
    '      "placement": string | null,  // one specific sentence: which surface, which side, how many, at what height, relative to visible objects',
    '      "box": { "x": number, "y": number, "width": number, "height": number } | null,',
    '      "reason": string | null      // why it is not applicable, otherwise null',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Include exactly one entry per requested modification.",
    "- box marks the area of the photo the modification would occupy, as fractions of the image (0–1): x and y are the top-left corner measured from the left and top edges.",
    "- Keep each box tight around where the item goes; do not cover the whole image.",
    "- When applicable is false, set placement and box to null and explain in reason.",
  ].join("\n");
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeBox(value: unknown): PlacementBox | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }

  const left = clampUnit(x as number);
  const top = clampUnit(y as number);
  const box = {
    x: left,
    y: top,
    width: clampUnit(Math.min(width as number, 1 - left)),
    height: clampUnit(Math.min(height as number, 1 - top)),
  };

  return box.width > 0 && box.height > 0 ? box : null;
}

/**
 * Keeps only entries for requested codes (first one wins), drops malformed
 * boxes, and returns null when nothing usable is left.
 */
export function normalizePlacementPlan(raw: unknown, modificationCodes: string[]): PlacementPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const { visibleElements, placements } = raw as Record<string, unknown>;
  if (!Array.isArray(placements)) return null;

  const requested = new Set(modificationCodes);
  const seen = new Set<string>();
  const entries: ModificationPlacementPlanEntry[] = [];

  for (const item of placements) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const code = asNonEmptyString(entry.modificationCode);
    if (!code || !requested.has(code) || seen.has(code)) continue;
    seen.add(code);

    const applicable = entry.applicable !== false;
    entries.push({
      modificationCode: code,
      applicable,
      placement: applicable ? asNonEmptyString(entry.placement) : null,
      box: applicable ? normalizeBox(entry.box) : null,
      reason: asNonEmptyString(entry.reason),
    });
  }

  if (entries.length === 0) return null;

  return {
    visibleElements: Array.isArray(visibleElements)
      ? visibleElements.map(asNonEmptyString).filter((v): v is string => v !== null)
      : [],
    placements: entries,
  };
}

export async function planModificationPlacement(
  source: { buffer: Buffer; mimeType: string },
  modificationCodes: string[]
): Promise<PlacementPlanResult> {
  const model = PHOTO_ANALYSIS_MODEL_NAME;
  const base = { model, promptVersion: PLACEMENT_PLANNER_PROMPT_VERSION };
  const codes = [...new Set(modificationCodes)];

  if (codes.length === 0) {
    return { ...base, status: "FAILED", error: "No modification codes to plan", rawResponse: null };
  }

  let rawResponse: string | null = null;

  try {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPlacementPlannerPrompt(codes) },
              {
                type: "image_url",
                image_url: { url: `data:${source.mimeType};base64,${source.buffer.toString("base64")}` },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      },
      { timeout: PLANNER_TIMEOUT_MS }
    );

    rawResponse = response.choices?.[0]?.message?.content ?? null;
    if (!rawResponse) {
      return { ...base, status: "FAILED", error: "OpenAI returned no content", rawResponse };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      return { ...base, status: "FAILED", error: "Failed to parse placement plan as JSON", rawResponse };
    }

    const plan = normalizePlacementPlan(parsed, codes);
    if (!plan) {
      return { ...base, status: "FAILED", error: "Placement plan had no usable entries", rawResponse };
    }

    return {
      ...base,
      status: "READY",
      plan,
      rawResponse,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : null,
    };
  } catch (error) {
    return {
      ...base,
      status: "FAILED",
      error: error instanceof Error ? error.message : "Unknown placement planning error",
      rawResponse,
    };
  }
}
