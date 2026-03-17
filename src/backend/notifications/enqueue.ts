import { NotificationEventType } from "@prisma/client";
import { emailQueue } from "@/backend/queue";
import { NotificationJobPayload, queueNotification } from "@/backend/notifications/service";

export async function enqueueNotification(payload: NotificationJobPayload): Promise<void> {
  await queueNotification(payload);

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
    },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
      priority: payload.eventType === NotificationEventType.ESTIMATE_READY ? 1 : 2,
    }
  );
}
