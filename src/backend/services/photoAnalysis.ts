/**
 * AI photo analysis / scope inference.
 *
 * analyzeProjectPhoto() sends a client's uploaded photo to OpenAI's vision-capable
 * chat completions endpoint and asks it to classify which accessibility
 * modification(s) are visible, constrained to the existing MODIFICATION_CODES
 * taxonomy used elsewhere in the system (intake checklist, estimation, image
 * generation).
 *
 * On any failure (missing API key, disabled flag, network error, timeout,
 * malformed response) this returns a non-throwing "no signal" result rather
 * than throwing, so callers never need special-case error handling to stay
 * safe — the absence of a signal is itself a valid, expected outcome.
 */
import { getOpenAIClient } from "lib/openai";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import { prisma } from "lib/prisma";
import { MODIFICATION_CODES, ModificationCode } from "@/backend/eligibility/types";
import { normalizeModificationItems } from "@/backend/eligibility/modificationNormalization";
import { PHOTO_ANALYSIS_MODEL_NAME } from "@/backend/services/photoAnalysisModelConfig";
import { getIntakeModificationLabels } from "@/backend/services/estimateGeneration";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { manualReviewQueue } from "@/backend/queue";

export type PhotoAnalysisConfidence = "HIGH" | "MEDIUM" | "LOW";
export type PhotoAnalysisStatus = "READY" | "FAILED" | "SKIPPED";

export interface PhotoAnalysisResult {
  status: PhotoAnalysisStatus;
  modificationCodes: ModificationCode[];
  confidence: PhotoAnalysisConfidence | null;
  rationale: string | null;
  model: string | null;
  error: string | null;
}

const ANALYSIS_TIMEOUT_MS = 60_000;

const VALID_MODIFICATION_CODES = new Set<string>(Object.values(MODIFICATION_CODES));

// ---------------------------------------------------------------------------
// Debug logger — set PHOTO_ANALYSIS_DEBUG=false to silence
// ---------------------------------------------------------------------------

const DEBUG = (process.env.PHOTO_ANALYSIS_DEBUG ?? "true").toLowerCase() !== "false";

function debug(tag: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const prefix = `[PHOTO_ANALYSIS:${tag}] ${ts}`;
  if (data !== undefined) {
    console.log(`${prefix} — ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} — ${message}`);
  }
}

function noSignalResult(status: PhotoAnalysisStatus, error: string | null = null): PhotoAnalysisResult {
  return {
    status,
    modificationCodes: [],
    confidence: null,
    rationale: null,
    model: null,
    error,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildPhotoAnalysisPrompt(): string {
  const codes = Object.values(MODIFICATION_CODES).join(", ");
  return (
    `You are analyzing a photo submitted as part of a home accessibility modification request. ` +
    `Identify which of the following accessibility modification types are visibly relevant to this photo ` +
    `(i.e. the modification appears to already be needed or partially present in the space shown): ${codes}. ` +
    `Only use codes from that exact list — do not invent new ones. If nothing in the photo suggests any of ` +
    `these modifications, return an empty array. ` +
    `Return ONLY valid JSON in this exact shape: ` +
    `{ "modificationCodes": string[], "confidence": "HIGH" | "MEDIUM" | "LOW", "rationale": string }.`
  );
}

// ---------------------------------------------------------------------------
// JSON parsing (mirrors the extraction approach used by grant discovery's
// OpenAI integration, kept local/self-contained rather than shared across
// the eligibility and photo-analysis domains)
// ---------------------------------------------------------------------------

interface RawPhotoAnalysisResponse {
  modificationCodes?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function parseModelResponse(content: string): RawPhotoAnalysisResponse | null {
  const trimmed = content.trim();

  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    extractBalancedJsonObject(trimmed),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as RawPhotoAnalysisResponse;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function normalizeParsedResponse(
  parsed: RawPhotoAnalysisResponse,
  model: string
): PhotoAnalysisResult {
  const rawCodes = Array.isArray(parsed.modificationCodes) ? parsed.modificationCodes : [];
  const modificationCodes = rawCodes
    .filter((code): code is string => typeof code === "string")
    .filter((code) => VALID_MODIFICATION_CODES.has(code)) as ModificationCode[];

  const confidence: PhotoAnalysisConfidence =
    parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW"
      ? parsed.confidence
      : "LOW";

  return {
    status: "READY",
    modificationCodes: Array.from(new Set(modificationCodes)),
    confidence,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : null,
    model,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

function mockAnalysisResult(): PhotoAnalysisResult {
  debug("MOCK", "MOCK MODE — returning hardcoded analysis instead of calling OpenAI");
  return {
    status: "READY",
    modificationCodes: [MODIFICATION_CODES.GRAB_BARS],
    confidence: "MEDIUM",
    rationale: "Mock: bathroom fixtures visible consistent with a grab-bar installation need.",
    model: "mock",
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyzes a single project photo and returns the AI-inferred modification
 * codes. `photoUrl` may be a public URL or an S3 object URL (signed
 * automatically). Never throws.
 */
export async function analyzeProjectPhoto(photoUrl: string): Promise<PhotoAnalysisResult> {
  debug("MAIN", "=== analyzeProjectPhoto START ===", { photoUrl });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    debug("MAIN", "OPENAI_API_KEY not set — skipping analysis");
    return noSignalResult("SKIPPED", "OPENAI_API_KEY not set");
  }

  const enabled = (process.env.PHOTO_ANALYSIS_AI_ENABLED ?? "true").toLowerCase();
  if (enabled === "false") {
    debug("MAIN", "PHOTO_ANALYSIS_AI_ENABLED=false — skipping analysis");
    return noSignalResult("SKIPPED", "PHOTO_ANALYSIS_AI_ENABLED=false");
  }

  if ((process.env.PHOTO_ANALYSIS_MOCK_AI ?? "false").toLowerCase() === "true") {
    return mockAnalysisResult();
  }

  try {
    const signedUrl = photoUrl.includes(".amazonaws.com")
      ? await getSignedDownloadUrlFromS3Url(photoUrl, 300)
      : photoUrl;

    const client = getOpenAIClient();
    const prompt = buildPhotoAnalysisPrompt();

    debug("MAIN", `Calling OpenAI chat completions — model: ${PHOTO_ANALYSIS_MODEL_NAME}`);

    const response = await client.chat.completions.create(
      {
        model: PHOTO_ANALYSIS_MODEL_NAME,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: signedUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      },
      { timeout: ANALYSIS_TIMEOUT_MS }
    );

    const content = response.choices?.[0]?.message?.content ?? null;
    debug("MAIN", "OpenAI response received", { contentPreview: content?.slice(0, 400) ?? null });

    if (!content) {
      debug("MAIN", "No content in response");
      return noSignalResult("FAILED", "OpenAI returned no content");
    }

    const parsed = parseModelResponse(content);
    if (!parsed) {
      debug("MAIN", "JSON parse error", { raw: content.slice(0, 500) });
      return noSignalResult("FAILED", "Failed to parse OpenAI response as JSON");
    }

    const result = normalizeParsedResponse(parsed, PHOTO_ANALYSIS_MODEL_NAME);
    debug("MAIN", "=== analyzeProjectPhoto END ===", {
      modificationCodes: result.modificationCodes,
      confidence: result.confidence,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown photo analysis error";
    debug("MAIN", "Analysis threw an exception — returning no-signal result", { error: errorMessage });
    return noSignalResult("FAILED", errorMessage);
  }
}

// ---------------------------------------------------------------------------
// Job processing (invoked from the ai-jobs queue worker)
// ---------------------------------------------------------------------------

export const PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE = "PHOTO_MODIFICATION_ANALYSIS" as const;

export interface PhotoModificationAnalysisJobPayload {
  photoId: string;
}

function sameCodeSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((code) => setA.has(code));
}

/**
 * Processes one photo-analysis job: runs analyzeProjectPhoto(), persists the
 * result on the Photo row, and — only on READY results — reconciles the
 * AI-inferred codes against the client's declared draftData.modificationItems.
 *
 * Reconciliation never overwrites the client's declared codes: agreement is a
 * no-op, and disagreement (or LOW AI confidence) enqueues a manual-review flag
 * (PHOTO_MODIFICATION_MISMATCH) via the existing manual-review queue/worker,
 * which staff can act on. FAILED/SKIPPED results have no signal to reconcile,
 * so the client's declared codes are left as the only source of truth.
 */
export async function processPhotoModificationAnalysisJob(
  payload: PhotoModificationAnalysisJobPayload
): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: payload.photoId },
    include: { project: true },
  });

  if (!photo) {
    throw new Error(`Photo not found: ${payload.photoId}`);
  }

  await prisma.photo.update({
    where: { id: photo.id },
    data: { analysisStatus: "ANALYZING" },
  });

  const startedAt = Date.now();
  const result = await analyzeProjectPhoto(photo.url);

  await prisma.photo.update({
    where: { id: photo.id },
    data: {
      analysisStatus: result.status,
      aiModificationCodes: result.modificationCodes,
      aiConfidence: result.confidence,
      analysisModel: result.model,
      analysisError: result.error,
      analyzedAt: new Date(),
    },
  });

  await logAuditEventNonBlocking({
    category: "AI_GENERATION",
    action: result.status === "READY" ? "PHOTO_MODIFICATION_ANALYSIS_READY" : "PHOTO_MODIFICATION_ANALYSIS_FAILED",
    outcome: result.status === "READY" ? "SUCCESS" : "FAILURE",
    sensitivityLevel: "INTERNAL",
    projectId: photo.projectId,
    resourceType: "photo",
    resourceId: photo.id,
    description:
      result.status === "READY"
        ? "AI photo analysis completed"
        : `AI photo analysis produced no signal (${result.status}): ${result.error ?? "unknown reason"}`,
    metadata: {
      model: result.model,
      confidence: result.confidence,
      modificationCodes: result.modificationCodes,
      status: result.status,
      error: result.error,
      durationMs: Date.now() - startedAt,
    },
  });

  if (result.status !== "READY") {
    return;
  }

  const declaredCodes = normalizeModificationItems(getIntakeModificationLabels(photo.project.draftData));
  const aiInferredCodes = result.modificationCodes;
  const isMismatch = !sameCodeSet(declaredCodes, aiInferredCodes);
  const isLowConfidence = result.confidence === "LOW";

  if (!isMismatch && !isLowConfidence) {
    return;
  }

  await manualReviewQueue.add(
    "manual-review",
    {
      projectId: photo.projectId,
      reason: "PHOTO_MODIFICATION_MISMATCH",
      aiConfidence: result.confidence ?? "LOW",
      photoId: photo.id,
      metadata: { declaredCodes, aiInferredCodes },
    },
    {
      jobId: `manual-review-${photo.projectId}-photo-${photo.id}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    }
  );
}
