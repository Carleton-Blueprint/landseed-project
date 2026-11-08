import { readReasoningEffortEnv, type OpenAiReasoningEffort } from "lib/openaiReasoningEffort";

/**
 * gpt-6.1-terra had the best recall and most stable codes in the 2026-11-07
 * comparison, at about gpt-4o-mini's per-photo cost (gpt-4o-mini bills ~34k
 * tokens per image). gpt-4o-mini-2024-07-18 shuts down 2027-01-14.
 */
export const DEFAULT_PHOTO_ANALYSIS_MODEL = "gpt-6.1-terra";
export const PHOTO_ANALYSIS_MODEL_NAME =
  process.env.PHOTO_ANALYSIS_AI_MODEL?.trim() || DEFAULT_PHOTO_ANALYSIS_MODEL;

/** PHOTO_ANALYSIS_AI_REASONING_EFFORT; null (unset) sends no reasoning_effort. */
export function getPhotoAnalysisReasoningEffort(): OpenAiReasoningEffort | null {
  return readReasoningEffortEnv("PHOTO_ANALYSIS_AI_REASONING_EFFORT");
}
