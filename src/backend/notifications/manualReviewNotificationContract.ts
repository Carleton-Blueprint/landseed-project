import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import type { NotificationJobPayload } from "@/backend/notifications/service";

export interface ManualReviewFlagNotificationPayload {
  projectId: string;
  projectAddress?: string | null;
  flagId: string;
  reason: string;
  description: string;
  adminEmails: string[];
}

export function buildManualReviewNotificationIdempotencyKey(flagId: string): string {
  return `manual-review-flag-created:${flagId}`;
}

export async function enqueueManualReviewFlagNotification(
  payload: ManualReviewFlagNotificationPayload
): Promise<void> {
  const adminDashboardUrl =
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const flaggedProjectsLink = `${adminDashboardUrl}/admin/flagged-projects`;

  for (const adminEmail of payload.adminEmails) {
    const jobPayload: NotificationJobPayload = {
      eventType: NotificationEventType.MANUAL_REVIEW_FLAG_CREATED,
      idempotencyKey: `${buildManualReviewNotificationIdempotencyKey(payload.flagId)}:${adminEmail}`,
      recipientEmail: adminEmail,
      recipientName: "Admin",
      projectId: payload.projectId,
      projectAddress: payload.projectAddress,
      estimateLink: flaggedProjectsLink,
      manualReviewReason: payload.reason,
      manualReviewDescription: payload.description,
    };

    await enqueueNotification(jobPayload);
  }
}
