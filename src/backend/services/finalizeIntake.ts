import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export interface FinalizeIntakeInput {
  projectId: string;
  actorUserId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PreliminaryRange {
  min: number;
  max: number;
}

export type FinalizeIntakeResult =
  | {
      ok: true;
      projectId: string;
      status: "submitted" | "already_finalized";
      message: string;
      range?: PreliminaryRange;
      quoteId?: string;
    }
  | {
      ok: false;
      code: "PROJECT_NOT_FOUND";
      projectId: string;
      status: "unknown";
      message: string;
    };

function toRangeFromQuote(quote: { id: string; estimateMin: { toString(): string } | null; estimateMax: { toString(): string } | null }) {
  if (quote.estimateMin == null || quote.estimateMax == null) {
    return { quoteId: quote.id };
  }

  return {
    quoteId: quote.id,
    range: {
      min: Number(quote.estimateMin.toString()),
      max: Number(quote.estimateMax.toString()),
    },
  };
}

export async function finalizeIntake(input: FinalizeIntakeInput): Promise<FinalizeIntakeResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
      userId: true,
      photos: {
        select: { id: true },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          estimateMin: true,
          estimateMax: true,
        },
      },
    },
  });

  if (!project) {
    return {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      projectId: input.projectId,
      status: "unknown",
      message: "Project not found.",
    };
  }

  if (project.status !== "draft") {
    const latestQuote = project.quotes[0];
    const quoteData = latestQuote ? toRangeFromQuote(latestQuote) : {};

    return {
      ok: true,
      projectId: project.id,
      status: "already_finalized",
      message: "Project is already finalized.",
      ...quoteData,
    };
  }

  const transitionResult = await prisma.$transaction(async (tx) => {
    return tx.project.updateMany({
      where: {
        id: project.id,
        status: "draft",
      },
      data: {
        status: "submitted",
      },
    });
  });

  if (transitionResult.count === 0) {
    // Race condition safety: another request finalized in parallel.
    const latestQuote = await prisma.quote.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        estimateMin: true,
        estimateMax: true,
      },
    });

    const quoteData = latestQuote ? toRangeFromQuote(latestQuote) : {};

    return {
      ok: true,
      projectId: project.id,
      status: "already_finalized",
      message: "Project was finalized by another request.",
      ...quoteData,
    };
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "INTAKE_FINALIZED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    description: "Intake finalized. Project transitioned from draft to submitted.",
    metadata: {
      previousStatus: "draft",
      nextStatus: "submitted",
      photoCount: project.photos.length,
      idempotent: false,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    projectId: project.id,
    status: "submitted",
    message: "Intake finalized successfully.",
  };
}
