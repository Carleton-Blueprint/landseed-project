import { NotificationEventType } from "@prisma/client";
import { prisma } from "lib/prisma";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import {
  buildEstimateReadyIdempotencyKey,
  type EstimateReadyTriggerSource,
} from "@/backend/notifications/estimateReadyContract";

export interface MarkEstimateReadyForReviewInput {
  projectId: string;
  quoteId: string;
  triggerSource: EstimateReadyTriggerSource;
}

export interface MarkEstimateReadyForReviewResult {
  projectId: string;
  quoteId: string;
  projectStatus: string;
  triggerSource: EstimateReadyTriggerSource;
  notified: boolean;
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

  if (project.status !== "estimate_ready") {
    await prisma.project.update({
      where: { id: input.projectId },
      data: { status: "estimate_ready" },
    });
  }

  if (!project.user.email) {
    return {
      projectId: input.projectId,
      quoteId: input.quoteId,
      projectStatus: "estimate_ready",
      triggerSource: input.triggerSource,
      notified: false,
      skippedReason: "MISSING_RECIPIENT_EMAIL",
    };
  }

  const estimateBaseUrl =
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  await enqueueNotification({
    eventType: NotificationEventType.ESTIMATE_READY,
    idempotencyKey: buildEstimateReadyIdempotencyKey(input.quoteId),
    recipientEmail: project.user.email,
    recipientName: project.user.name,
    userId: project.user.id,
    projectId: project.id,
    projectAddress: project.address,
    estimateLink: `${estimateBaseUrl}/projects/${project.id}/estimate`,
  });

  return {
    projectId: input.projectId,
    quoteId: input.quoteId,
    projectStatus: "estimate_ready",
    triggerSource: input.triggerSource,
    notified: true,
  };
}
