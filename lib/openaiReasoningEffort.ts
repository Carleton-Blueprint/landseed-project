/**
 * Optional reasoning effort for OpenAI calls, read from an env variable.
 *
 * Kept out of lib/openai.ts because tests replace that module with a mock
 * that only provides getOpenAIClient.
 */
export const OPENAI_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

// Warn once per bad value rather than on every call.
const warnedInvalidEfforts = new Set<string>();

/**
 * Returns the effort named by `envName`, or null when it's unset or invalid.
 * Null means "don't send a reasoning effort at all", which non-reasoning
 * models such as gpt-4o-mini need (they reject the parameter).
 */
export function readReasoningEffortEnv(envName: string): OpenAiReasoningEffort | null {
  const raw = process.env[envName]?.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if ((OPENAI_REASONING_EFFORTS as readonly string[]).includes(raw)) {
    return raw as OpenAiReasoningEffort;
  }
  const warnKey = `${envName}=${raw}`;
  if (!warnedInvalidEfforts.has(warnKey)) {
    warnedInvalidEfforts.add(warnKey);
    console.warn(
      `[openai] Invalid ${envName} "${raw}"; expected one of ${OPENAI_REASONING_EFFORTS.join(", ")}. Sending no reasoning effort.`
    );
  }
  return null;
}
