import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import type { NotificationJobPayload } from "@/backend/notifications/service";

export interface InformationRequestNotificationPayload {
  informationRequestId: string;
  projectId: string;
  projectAddress: string;
  requestType: string;
  message: string;
  requestedByUserId: string;
  clientUserId: string;
  clientEmail: string;
  clientName?: string | null;
}

export function buildInformationRequestNotificationIdempotencyKey(
  informationRequestId: string
): string {
  return `information-request-created:${informationRequestId}`;
}

export async function enqueueInformationRequestNotificationForClient(
  payload: InformationRequestNotificationPayload
): Promise<void> {
  const appBaseUrl =
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const dashboardLink = `${appBaseUrl}/dashboard/${payload.projectId}`;

  const jobPayload: NotificationJobPayload = {
    eventType: NotificationEventType.INFORMATION_REQUEST_CREATED,
    idempotencyKey: buildInformationRequestNotificationIdempotencyKey(
      payload.informationRequestId
    ),
    recipientEmail: payload.clientEmail,
    recipientName: payload.clientName,
    userId: payload.clientUserId,
    projectId: payload.projectId,
    projectAddress: payload.projectAddress,
    estimateLink: dashboardLink,
    senderId: payload.requestedByUserId,
    linkedResourceId: payload.informationRequestId,
    informationRequestType: payload.requestType,
    informationRequestMessage: payload.message,
  };

  await enqueueNotification(jobPayload);
}
