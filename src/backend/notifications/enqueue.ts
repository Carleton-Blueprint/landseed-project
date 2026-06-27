import { NotificationEventType } from "@prisma/client";
import { emailQueue } from "@/backend/queue";
import { NotificationJobPayload, queueNotification } from "@/backend/notifications/service";

export async function enqueueNotification(payload: NotificationJobPayload): Promise<void> {
  await queueNotification(payload);

  const isEstimateLifecycleEvent =
    payload.eventType === NotificationEventType.ESTIMATE_READY ||
    payload.eventType === NotificationEventType.ESTIMATE_EXPIRED ||
    payload.eventType === NotificationEventType.ESTIMATE_REACTIVATED;

  const isAuthEvent =
    payload.eventType === NotificationEventType.EMAIL_VERIFICATION ||
    payload.eventType === NotificationEventType.PASSWORD_RESET;

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
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      noticeId: payload.noticeId,
      accountDeletionRequestId: payload.accountDeletionRequestId,
      scheduledFor: payload.scheduledFor,
      authActionLink: payload.authActionLink,
      seniorName: payload.seniorName,
      isCaregiverSubmission: payload.isCaregiverSubmission,
    },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
      priority: isEstimateLifecycleEvent || isAuthEvent ? 1 : 2,
    }
  );
}
