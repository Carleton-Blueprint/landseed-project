/**
 * FR-4.3 Phase 4: notifies a client when a post-estimate override changes
 * their quote's visible total. Structured like markEstimateReadyForReview in
 * estimateReadyTransition.ts, but the idempotency key must vary per override
 * event (unlike ESTIMATE_READY's one-shot key) since a quote can legitimately
 * be overridden, and thus notified about, more than once.
 */
import { NotificationEventType } from "@prisma/client";
import { prisma } from "lib/prisma";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export interface NotifyEstimateUpdatedInput {
  projectId: string;
  quoteId: string;
  overrideId: string;
  overriddenAt: Date;
  previousTotal: number;
  newTotal: number;
  actorUserId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface NotifyEstimateUpdatedResult {
  projectId: string;
  quoteId: string;
  notificationIdempotencyKey: string;
  notified: boolean;
  notificationQueuedAt?: string;
  skippedReason?: "MISSING_RECIPIENT_EMAIL";
}

export function buildEstimateUpdatedIdempotencyKey(overrideId: string, overriddenAt: Date): string {
  return `estimate-updated:${overrideId}-${overriddenAt.getTime()}`;
}

export async function notifyEstimateUpdated(
  input: NotifyEstimateUpdatedInput
): Promise<NotifyEstimateUpdatedResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      address: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  const notificationIdempotencyKey = buildEstimateUpdatedIdempotencyKey(input.overrideId, input.overriddenAt);

  if (!project.user.email) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_UPDATED_NOTIFICATION_SKIPPED",
      outcome: "SUCCESS",
      sensitivityLevel: "CONFIDENTIAL",
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      quoteId: input.quoteId,
      resourceType: "notification",
      resourceId: notificationIdempotencyKey,
      description: "Estimate updated notification skipped due to missing recipient email",
      metadata: { skippedReason: "MISSING_RECIPIENT_EMAIL" },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      projectId: input.projectId,
      quoteId: input.quoteId,
      notificationIdempotencyKey,
      notified: false,
      skippedReason: "MISSING_RECIPIENT_EMAIL",
    };
  }

  const estimateBaseUrl = process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const estimateLink = `${estimateBaseUrl}/projects/${project.id}/estimate`;

  await enqueueNotification({
    eventType: NotificationEventType.ESTIMATE_UPDATED,
    idempotencyKey: notificationIdempotencyKey,
    recipientEmail: project.user.email,
    recipientName: project.user.name,
    userId: project.user.id,
    projectId: project.id,
    projectAddress: project.address,
    estimateLink,
    previousTotal: input.previousTotal,
    newTotal: input.newTotal,
  });

  const notificationQueuedAt = new Date().toISOString();

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "ESTIMATE_UPDATED_NOTIFICATION_QUEUED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    quoteId: input.quoteId,
    resourceType: "notification",
    resourceId: notificationIdempotencyKey,
    description: "Estimate updated notification queued",
    metadata: {
      eventType: NotificationEventType.ESTIMATE_UPDATED,
      recipientEmail: project.user.email,
      estimateLink,
      previousTotal: input.previousTotal,
      newTotal: input.newTotal,
      queuedAt: notificationQueuedAt,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    projectId: input.projectId,
    quoteId: input.quoteId,
    notificationIdempotencyKey,
    notified: true,
    notificationQueuedAt,
  };
}
