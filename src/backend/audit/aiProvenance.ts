/**
 * Shared vocabulary for the `outputSource`/`isFallback` fields written into every
 * AI_GENERATION-category audit event's metadata (image generation, photo analysis,
 * grant discovery, pricing), so staff can filter/query the audit trail the same way
 * regardless of which AI service produced the event.
 */
export type AiOutputSource =
  | "LIVE" // A live provider call produced the output.
  | "MOCK" // A hardcoded/placeholder mock produced the output (intentionally or as a fallback).
  | "HEURISTIC" // A deterministic non-AI algorithm produced the output (grant discovery's catalog scorer).
  | "MANUAL" // A staff member entered the output directly — no AI involved (Manual Mode).
  | "NONE"; // No output was produced (live call failed or was skipped, with no fallback applied).

export interface AiProvenanceMetadata {
  outputSource: AiOutputSource;
  /** True only when outputSource reflects a fallback after a live attempt failed — not an intentional mock/disabled config. */
  isFallback: boolean;
}
