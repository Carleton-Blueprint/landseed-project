import {
  NotificationDeliveryStatus,
  NotificationEventType,
  Prisma,
  CommunicationStatus,
} from "@prisma/client";
import { prisma } from "lib/prisma";
import { renderEmailTemplate } from "@/backend/notifications/emailTemplates";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logCommunication } from "@/backend/services/communicationHistoryLogger";
import {
  getCategoryFromEventType,
  generateContentSummary,
  getLinkedResourceType,
} from "@/backend/services/communicationHistoryIntegration";

export type NotificationJobPayload = {
  eventType: NotificationEventType;
  idempotencyKey: string;
  recipientEmail: string;
  recipientName?: string | null;
  userId?: string;
  projectId?: string;
  projectAddress?: string | null;
  estimateLink?: string | null;
  estimateMin?: number;
  estimateMax?: number;
  questionCategory?: string;    
  questionSubject?: string;
  fileName?: string;
  documentType?: string;
};

export interface NotificationDeliveryMetricsInput {
  eventType?: NotificationEventType;
  projectId?: string;
  since?: Date;
  failedLimit?: number;
}

export interface NotificationDeliveryMetrics {
  eventType?: NotificationEventType;
  projectId?: string;
  since?: Date;
  totalDeliveries: number;
  pendingDeliveries: number;
  sentDeliveries: number;
  failedDeliveries: number;
  recentFailures: Array<{
    idempotencyKey: string;
    recipientEmail: string;
    eventType: NotificationEventType;
    lastError: string | null;
    attempts: number;
    updatedAt: Date;
  }>;
}

export async function getNotificationDeliveryMetrics(
  input: NotificationDeliveryMetricsInput = {}
): Promise<NotificationDeliveryMetrics> {
  const { eventType, projectId, since, failedLimit = 25 } = input;
  const whereBase: Prisma.NotificationDeliveryWhereInput = {
    ...(eventType ? { eventType } : {}),
    ...(projectId ? { projectId } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  const [
    totalDeliveries,
    pendingDeliveries,
    sentDeliveries,
    failedDeliveries,
    recentFailures,
  ] = await Promise.all([
    prisma.notificationDelivery.count({ where: whereBase }),
    prisma.notificationDelivery.count({
      where: {
        ...whereBase,
        status: NotificationDeliveryStatus.PENDING,
      },
    }),
    prisma.notificationDelivery.count({
      where: {
        ...whereBase,
        status: NotificationDeliveryStatus.SENT,
      },
    }),
    prisma.notificationDelivery.count({
      where: {
        ...whereBase,
        status: NotificationDeliveryStatus.FAILED,
      },
    }),
    prisma.notificationDelivery.findMany({
      where: {
        ...whereBase,
        status: NotificationDeliveryStatus.FAILED,
      },
      select: {
        idempotencyKey: true,
        recipientEmail: true,
        eventType: true,
        lastError: true,
        attempts: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: failedLimit,
    }),
  ]);

  return {
    eventType,
    projectId,
    since,
    totalDeliveries,
    pendingDeliveries,
    sentDeliveries,
    failedDeliveries,
    recentFailures,
  };
}

export async function queueNotification(payload: NotificationJobPayload): Promise<void> {
  const existing = await prisma.notificationDelivery.findUnique({
    where: { idempotencyKey: payload.idempotencyKey },
    select: { id: true, status: true },
  });

  if (existing?.status === NotificationDeliveryStatus.SENT) {
    return;
  }

  const template = renderEmailTemplate({
    eventType: payload.eventType,
    recipientName: payload.recipientName,
    projectAddress: payload.projectAddress,
    estimateLink: payload.estimateLink,
    estimateMin: payload.estimateMin,
    estimateMax: payload.estimateMax,
    questionCategory: payload.questionCategory,
    questionSubject: payload.questionSubject,
    fileName: payload.fileName,
    documentType: payload.documentType,
  });

  // Strip undefined keys so payload remains valid JSON for Prisma Json fields.
  const payloadJson = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;

  await prisma.notificationDelivery.upsert({
    where: { idempotencyKey: payload.idempotencyKey },
    create: {
      eventType: payload.eventType,
      recipientEmail: payload.recipientEmail,
      subject: template.subject,
      templateName: template.templateName,
      status: NotificationDeliveryStatus.PENDING,
      idempotencyKey: payload.idempotencyKey,
      payload: payloadJson,
      userId: payload.userId,
      projectId: payload.projectId,
    },
    update: {
      recipientEmail: payload.recipientEmail,
      subject: template.subject,
      templateName: template.templateName,
      status: NotificationDeliveryStatus.PENDING,
      payload: payloadJson,
      userId: payload.userId,
      projectId: payload.projectId,
      lastError: null,
    },
  });
}

export async function processNotification(payload: NotificationJobPayload): Promise<void> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { idempotencyKey: payload.idempotencyKey },
    select: { id: true, status: true, attempts: true },
  });

  if (!delivery) {
    throw new Error(`Notification delivery record not found for ${payload.idempotencyKey}`);
  }

  if (delivery.status === NotificationDeliveryStatus.SENT) {
    return;
  }

  const template = renderEmailTemplate({
    eventType: payload.eventType,
    recipientName: payload.recipientName,
    projectAddress: payload.projectAddress,
    estimateLink: payload.estimateLink,
    estimateMin: payload.estimateMin,
    estimateMax: payload.estimateMax,
    questionCategory: payload.questionCategory,
    questionSubject: payload.questionSubject,
    fileName: payload.fileName,
    documentType: payload.documentType,
  });

  try {
    const result = await sendTransactionalEmail({
      to: payload.recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationDeliveryStatus.SENT,
        sentAt: new Date(),
        attempts: { increment: 1 },
        provider: result.provider,
        providerMessageId: result.messageId,
        lastError: null,
      },
    });

    if (payload.projectId) {
        await logCommunication({
          projectId: payload.projectId,
          communicationType: "EMAIL",
          category: getCategoryFromEventType(payload.eventType),
          recipientEmail: payload.recipientEmail,
          recipientId: payload.userId,
          subject: template.subject,
          contentSummary: generateContentSummary(payload, template),
          linkedResourceType: getLinkedResourceType(payload.eventType),
          linkedResourceId: undefined, // Set if you have the actual resource ID
          status: CommunicationStatus.SENT,
          metadata: {
            provider: result.provider,
            messageId: result.messageId,
            idempotencyKey: payload.idempotencyKey,
            eventType: payload.eventType,
          },
        });
      }


  } catch (error) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message : "Unknown email send error",
      },
    });

    if (payload.projectId) {
      try {
        await logCommunication({
          projectId: payload.projectId,
          communicationType: "EMAIL",
          category: getCategoryFromEventType(payload.eventType),
          recipientEmail: payload.recipientEmail,
          recipientId: payload.userId,
          subject: template.subject,
          contentSummary: generateContentSummary(payload, template),
          linkedResourceType: getLinkedResourceType(payload.eventType),
          linkedResourceId: undefined,
          status: CommunicationStatus.FAILED,
          metadata: {
            idempotencyKey: payload.idempotencyKey,
            eventType: payload.eventType,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      } catch (logError) {
        console.error("Failed to log communication history:", logError);
      }
    }

    throw error;
  }
}
