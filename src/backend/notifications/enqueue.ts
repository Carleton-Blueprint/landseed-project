import { NotificationEventType } from "@prisma/client";
import { emailQueue } from "@/backend/queue";
import { NotificationJobPayload, queueNotification } from "@/backend/notifications/service";

export async function enqueueNotification(payload: NotificationJobPayload): Promise<void> {
  await queueNotification(payload);

  const isEstimateLifecycleEvent =
    payload.eventType === NotificationEventType.ESTIMATE_READY ||
    payload.eventType === NotificationEventType.ESTIMATE_EXPIRED ||
    payload.eventType === NotificationEventType.ESTIMATE_REACTIVATED;

  await emailQueue.add(
    `notify-${payload.idempotencyKey}`,
    {
      eventType: payload.eventType,
      idempotencyKey: payload.idempotencyKey,
      recipientEmail: payload.recipientEmail,
      recipientName: payload.recipientName,
      userId: payload.userId,
      projectId: payload.projectId,
      projectAddress: payload.projectAddress,
      estimateLink: payload.estimateLink,
      estimateMin: payload.estimateMin,
      estimateMax: payload.estimateMax,
      manualFallbackExportLink: payload.manualFallbackExportLink,
      manualFallbackExportRetentionDays: payload.manualFallbackExportRetentionDays,
    },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
      priority: isEstimateLifecycleEvent ? 1 : 2,
    }
  );
}
