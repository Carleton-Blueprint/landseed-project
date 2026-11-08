import { readReasoningEffortEnv, type OpenAiReasoningEffort } from 'lib/openaiReasoningEffort';

export const DISCOVERY_MODEL_NAME =
  process.env.GRANT_DISCOVERY_AI_MODEL ?? 'gpt-4o-mini';
export const DISCOVERY_AI_ENABLED_DEFAULT = true;

/** GRANT_DISCOVERY_AI_REASONING_EFFORT; null (unset) sends no reasoning field. */
export function getDiscoveryReasoningEffort(): OpenAiReasoningEffort | null {
  return readReasoningEffortEnv('GRANT_DISCOVERY_AI_REASONING_EFFORT');
}
