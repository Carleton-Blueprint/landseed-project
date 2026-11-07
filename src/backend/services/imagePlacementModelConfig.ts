/**
 * Vision model selection and per-model pricing for the placement planner
 * (imagePlacementPlanner.ts).
 *
 * IMAGE_PLACEMENT_AI_MODEL picks the planner model (worker service only);
 * when unset it follows the photo-analysis model so existing deployments
 * keep working without a new variable.
 */
import { PHOTO_ANALYSIS_MODEL_NAME } from "@/backend/services/photoAnalysisModelConfig";
import { roundCostUsd } from "@/backend/services/imageGenerationModelConfig";

/** USD per 1,000,000 tokens, from https://developers.openai.com/api/docs/pricing (checked 2026-11-07). */
export interface ChatModelPrice {
  input: number;
  output: number;
}

export const PLACEMENT_PLANNER_PRICES_PER_MILLION_TOKENS_USD: Record<string, ChatModelPrice> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 }, // gpt-4o-mini-2024-07-18 shuts down 2027-01-14
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6.1-terra": { input: 1, output: 5 },
  "gpt-6.1-sol": { input: 2, output: 10 },
};

export function getPlacementPlannerModel(): string {
  return process.env.IMAGE_PLACEMENT_AI_MODEL?.trim() || PHOTO_ANALYSIS_MODEL_NAME;
}

export interface PlannerUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Null when the model has no known price; 0 when it's priced but no usage
 * came back (e.g. the request failed before a response). Cached prompt
 * tokens are billed at the full input rate here, so this can slightly
 * overestimate.
 */
export function computePlacementPlannerCostUsd(model: string, usage: PlannerUsage | null): number | null {
  const price = PLACEMENT_PLANNER_PRICES_PER_MILLION_TOKENS_USD[model];
  if (!price) {
    return null;
  }
  if (!usage) {
    return 0;
  }

  return roundCostUsd(
    (usage.promptTokens / 1_000_000) * price.input + (usage.completionTokens / 1_000_000) * price.output
  );
}
