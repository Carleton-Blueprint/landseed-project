import { readReasoningEffortEnv, type OpenAiReasoningEffort } from "lib/openaiReasoningEffort";

export const PHOTO_ANALYSIS_MODEL_NAME =
  process.env.PHOTO_ANALYSIS_AI_MODEL ?? "gpt-4o-mini";

/** PHOTO_ANALYSIS_AI_REASONING_EFFORT; null (unset) sends no reasoning_effort. */
export function getPhotoAnalysisReasoningEffort(): OpenAiReasoningEffort | null {
  return readReasoningEffortEnv("PHOTO_ANALYSIS_AI_REASONING_EFFORT");
}
