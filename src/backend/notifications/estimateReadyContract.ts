/**
 * FR-6.1 / FR-8.2 contract: estimate-ready email should be emitted by one
 * authoritative backend transition, with stable idempotency.
 */

export const ESTIMATE_READY_REVIEW_STATE = "READY_FOR_REVIEW" as const;

export const ESTIMATE_READY_TRIGGER_SOURCE = {
  ADVISORY_TEAM_MARK_READY_FOR_REVIEW: "advisory-team-mark-ready-for-review",
  LEGACY_QUOTE_GENERATION: "legacy-quote-generation",
  DELAYED_ESTIMATE_GENERATION: "delayed-estimate-generation",
} as const;

export type EstimateReadyTriggerSource =
  (typeof ESTIMATE_READY_TRIGGER_SOURCE)[keyof typeof ESTIMATE_READY_TRIGGER_SOURCE];

export interface EstimateReadyNotificationContract {
  quoteId: string;
  projectId: string;
  recipientEmail: string;
  recipientName?: string | null;
  userId?: string;
  projectAddress?: string | null;
  estimateLink?: string | null;
  estimateMin?: number;
  estimateMax?: number;
  triggerSource: EstimateReadyTriggerSource;
}

export function buildEstimateReadyIdempotencyKey(quoteId: string): string {
  return `estimate-ready:${quoteId}`;
}
