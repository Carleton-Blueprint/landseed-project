import { readReasoningEffortEnv, type OpenAiReasoningEffort } from 'lib/openaiReasoningEffort';

export const DEFAULT_DISCOVERY_MODEL = 'gpt-6-luna';
export const DISCOVERY_MODEL_NAME =
  process.env.GRANT_DISCOVERY_AI_MODEL?.trim() || DEFAULT_DISCOVERY_MODEL;
export const DISCOVERY_AI_ENABLED_DEFAULT = true;

/**
 * Low effort was as accurate as medium in the 2026-11-07 comparison and about
 * twice as fast; none often never responded with web_search.
 */
export const DEFAULT_DISCOVERY_REASONING_EFFORT: OpenAiReasoningEffort = 'low';

/**
 * GRANT_DISCOVERY_AI_REASONING_EFFORT, or `low` when it's unset and the model
 * is the default. A different model gets no effort unless one is set, because
 * some (e.g. gpt-4o-mini) reject the field.
 */
export function getDiscoveryReasoningEffort(): OpenAiReasoningEffort | null {
  const effort = readReasoningEffortEnv('GRANT_DISCOVERY_AI_REASONING_EFFORT');
  if (effort) {
    return effort;
  }
  if (!process.env.GRANT_DISCOVERY_AI_REASONING_EFFORT?.trim() && DISCOVERY_MODEL_NAME === DEFAULT_DISCOVERY_MODEL) {
    return DEFAULT_DISCOVERY_REASONING_EFFORT;
  }
  return null;
}
