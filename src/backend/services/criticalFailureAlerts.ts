import { incrementFailureCounter } from "@/backend/monitoring/failureWindow";
import { getAlertThreshold, type AlertThresholdKey } from "@/backend/services/alertThresholds";
import { sendAdminAlert } from "@/backend/services/adminAlerts";

export interface RecordFailureInput {
  key: AlertThresholdKey;
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * Records one failure toward a critical-failure alert threshold and fires
 * the alert exactly once, the moment the count first reaches the
 * threshold — not again for every failure afterward within the same
 * window. No-ops if the threshold is disabled. Never throws: called from
 * fire-and-forget `worker.on('failed', ...)` handlers, where an unhandled
 * rejection would be an unhandledRejection on the worker process.
 */
export async function recordFailureAndMaybeAlert(input: RecordFailureInput): Promise<void> {
  try {
    const threshold = await getAlertThreshold(input.key);
    if (!threshold || !threshold.enabled) {
      return;
    }

    const count = await incrementFailureCounter(
      `alert-failure:${input.key}`,
      threshold.windowMinutes * 60
    );

    if (count === threshold.thresholdCount) {
      await sendAdminAlert({
        category: input.key,
        summary: input.summary,
        details: { ...input.details, failureCount: count, windowMinutes: threshold.windowMinutes },
      });
    }
  } catch (error) {
    console.error("Failed to record failure / evaluate alert threshold:", error);
  }
}
