import { Prisma, CommunicationStatus, CommunicationType, CommunicationCategory } from "@prisma/client";
import { prisma } from "lib/prisma";

export interface LogCommunicationInput {
  projectId: string;
  communicationType: CommunicationType;
  category: CommunicationCategory;
  recipientId?: string;
  recipientEmail: string;
  senderId?: string;
  subject: string;
  contentSummary: string; 
  linkedResourceType?: string;
  linkedResourceId?: string;
  status: CommunicationStatus;
  metadata?: Record<string, unknown>;
}

export interface GetCommunicationHistoryOptions {
  limit?: number;
  offset?: number;
  category?: CommunicationCategory;
  recipientId?: string;
  since?: Date;
  communicationType?: CommunicationType;
  status?: CommunicationStatus;
}

export async function logCommunication(input: LogCommunicationInput): Promise<string> {
  const result = await prisma.communicationHistory.create({
    data: {
      projectId: input.projectId,
      communicationType: input.communicationType,
      category: input.category,
      recipientId: input.recipientId,
      recipientEmail: input.recipientEmail,
      senderId: input.senderId,
      subject: input.subject,
      contentSummary: input.contentSummary,
      linkedResourceType: input.linkedResourceType,
      linkedResourceId: input.linkedResourceId,
      status: input.status,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });

  return result.id;
}

export async function getCommunicationHistoryForProject(
  projectId: string,
  options?: GetCommunicationHistoryOptions
) {
  const limit = Math.min(options?.limit ?? 50, 100);
  const offset = options?.offset ?? 0;

  const where: Prisma.CommunicationHistoryWhereInput = {
    projectId,
    ...(options?.category && { category: options.category }),
    ...(options?.recipientId && { recipientId: options.recipientId }),
    ...(options?.communicationType && { communicationType: options.communicationType }),
    ...(options?.status && { status: options.status }),
    ...(options?.since && { sentAt: { gte: options.since } }),
  };

  const [communications, total] = await Promise.all([
    prisma.communicationHistory.findMany({
      where,
      include: {
        recipient: { select: { id: true, name: true, email: true } },
        sender: { select: { id: true, name: true, email: true } },
      },
      orderBy: { sentAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.communicationHistory.count({ where }),
  ]);

  return {
    communications,
    total,
    limit,
    offset,
  };
}

export async function getCommunicationHistoryForRecipient(
  projectId: string,
  recipientId: string,
  options?: GetCommunicationHistoryOptions
) {
  return getCommunicationHistoryForProject(projectId, {
    ...options,
    recipientId,
  });
}

export async function getCommunicationSummaryForProject(projectId: string) {
  const summary = await prisma.communicationHistory.groupBy({
    by: ["communicationType", "status", "category"],
    where: { projectId },
    _count: true,
  });

  return summary;
}

export async function updateCommunicationStatus(
  communicationId: string,
  status: CommunicationStatus,
  deliveredAt?: Date,
  readAt?: Date
): Promise<void> {
  await prisma.communicationHistory.update({
    where: { id: communicationId },
    data: {
      status,
      ...(deliveredAt && { deliveredAt }),
      ...(readAt && { readAt }),
    },
  });
}
