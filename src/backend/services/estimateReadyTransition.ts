import { NotificationEventType } from "@prisma/client";
import { prisma } from "lib/prisma";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  buildEstimateReadyIdempotencyKey,
  type EstimateReadyTriggerSource,
} from "@/backend/notifications/estimateReadyContract";

export interface MarkEstimateReadyForReviewInput {
  projectId: string;
  quoteId: string;
  triggerSource: EstimateReadyTriggerSource;
  actorUserId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface MarkEstimateReadyForReviewResult {
  projectId: string;
  quoteId: string;
  projectStatus: string;
  triggerSource: EstimateReadyTriggerSource;
  notificationIdempotencyKey: string;
  notified: boolean;
  notificationQueuedAt?: string;
  skippedReason?: "MISSING_RECIPIENT_EMAIL";
}

export async function markEstimateReadyForReview(
  input: MarkEstimateReadyForReviewInput
): Promise<MarkEstimateReadyForReviewResult> {
  const [project, quote] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        address: true,
        status: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.quote.findUnique({
      where: { id: input.quoteId },
      select: { id: true, projectId: true },
    }),
  ]);

  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  if (!quote || quote.projectId !== input.projectId) {
    throw new Error(`Quote ${input.quoteId} does not belong to project ${input.projectId}`);
  }

  const notificationIdempotencyKey = buildEstimateReadyIdempotencyKey(input.quoteId);

  if (project.status !== "estimate_ready") {
    await prisma.project.update({
      where: { id: input.projectId },
      data: { status: "estimate_ready" },
    });
  }

  if (!project.user.email) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_READY_NOTIFICATION_SKIPPED",
      outcome: "SUCCESS",
      sensitivityLevel: "CONFIDENTIAL",
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      quoteId: input.quoteId,
      resourceType: "notification",
      resourceId: notificationIdempotencyKey,
      description: "Estimate ready notification skipped due to missing recipient email",
      metadata: {
        triggerSource: input.triggerSource,
        skippedReason: "MISSING_RECIPIENT_EMAIL",
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      projectId: input.projectId,
      quoteId: input.quoteId,
      projectStatus: "estimate_ready",
      triggerSource: input.triggerSource,
      notificationIdempotencyKey,
      notified: false,
      skippedReason: "MISSING_RECIPIENT_EMAIL",
    };
  }

  const estimateBaseUrl =
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  const estimateLink = `${estimateBaseUrl}/projects/${project.id}/estimate`;

  await enqueueNotification({
    eventType: NotificationEventType.ESTIMATE_READY,
    idempotencyKey: notificationIdempotencyKey,
    recipientEmail: project.user.email,
    recipientName: project.user.name,
    userId: project.user.id,
    projectId: project.id,
    projectAddress: project.address,
    estimateLink,
  });

  const notificationQueuedAt = new Date().toISOString();

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "ESTIMATE_READY_NOTIFICATION_QUEUED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    quoteId: input.quoteId,
    resourceType: "notification",
    resourceId: notificationIdempotencyKey,
    description: "Estimate ready notification queued",
    metadata: {
      eventType: NotificationEventType.ESTIMATE_READY,
      triggerSource: input.triggerSource,
      recipientEmail: project.user.email,
      estimateLink,
      queuedAt: notificationQueuedAt,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    projectId: input.projectId,
    quoteId: input.quoteId,
    projectStatus: "estimate_ready",
    triggerSource: input.triggerSource,
    notificationIdempotencyKey,
    notified: true,
    notificationQueuedAt,
  };
}
