import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { estimateGenerationQueue, aiJobsQueue } from "@/backend/queue";
import {
  buildEstimateGenerationJobId,
  getEstimateGenerationDelayMs,
} from "@/backend/services/estimateGeneration";
import { getPricingSourceFromRefinedEstimate } from "@/backend/services/pricingSource";
import { PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE } from "@/backend/services/photoAnalysis";

export interface FinalizeIntakeInput {
  projectId: string;
  actorUserId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PreliminaryRange {
  min: number;
  max: number;
  source: "serp_api" | "serp_api_partial";
  generatedAt: string;
}

type QuoteRangeResult =
  | {
      quoteId: string;
      range: PreliminaryRange;
    }
  | {
      quoteId: string;
      range?: never;
    };

export type FinalizeIntakeResult =
  | {
      ok: true;
      projectId: string;
      status: "submitted" | "estimate_ready" | "already_finalized";
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

interface QuoteRecordShape {
  id: string;
  estimateMin: { toString(): string } | null;
  estimateMax: { toString(): string } | null;
  generatedAt: Date;
  refinedEstimate: unknown;
}

function toQuoteRangeResult(quote: QuoteRecordShape): QuoteRangeResult {
  if (quote.estimateMin == null || quote.estimateMax == null) {
    return { quoteId: quote.id };
  }

  return {
    quoteId: quote.id,
    range: {
      min: Number(quote.estimateMin.toString()),
      max: Number(quote.estimateMax.toString()),
      source: getPricingSourceFromRefinedEstimate(quote.refinedEstimate),
      generatedAt: quote.generatedAt.toISOString(),
    },
  };
}

export async function finalizeIntake(input: FinalizeIntakeInput): Promise<FinalizeIntakeResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
      draftData: true,
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          estimateMin: true,
          estimateMax: true,
          generatedAt: true,
          refinedEstimate: true,
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
    const quoteData = latestQuote ? toQuoteRangeResult(latestQuote) : null;

    return {
      ok: true,
      projectId: project.id,
      status: "already_finalized",
      message: "Project is already finalized.",
      ...(quoteData ? { quoteId: quoteData.quoteId } : {}),
      ...(quoteData && "range" in quoteData ? { range: quoteData.range } : {}),
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
    const latestQuote = await prisma.quote.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        estimateMin: true,
        estimateMax: true,
        generatedAt: true,
        refinedEstimate: true,
      },
    });

    const quoteData = latestQuote ? toQuoteRangeResult(latestQuote) : null;
    return {
      ok: true,
      projectId: project.id,
      status: "already_finalized",
      message: "Project was finalized by another request.",
      ...(quoteData ? { quoteId: quoteData.quoteId } : {}),
      ...(quoteData && "range" in quoteData ? { range: quoteData.range } : {}),
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
      idempotent: false,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await estimateGenerationQueue.add(
    "generate-estimate",
    {
      projectId: project.id,
      actorUserId: input.actorUserId,
    },
    {
      jobId: buildEstimateGenerationJobId(project.id),
      delay: getEstimateGenerationDelayMs(),
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    }
  );

  // Sweep photos that finished virus scanning before the project was promoted — the
  // clean-scan trigger in virusScanWorker.ts defers to this point in that case, since
  // Project.draftData (and the client's declared modification codes) only exists now.
  // Reuses the same jobId as the clean-scan trigger, so if a scan happens to clear right
  // around promotion and both paths fire, BullMQ's jobId dedup makes the second a no-op.
  const cleanUnanalyzedPhotos = await prisma.photo.findMany({
    where: {
      projectId: project.id,
      virus_scan_status: "clean",
      analysisStatus: { notIn: ["READY", "ANALYZING"] },
    },
    select: { id: true },
  });

  for (const photo of cleanUnanalyzedPhotos) {
    try {
      await aiJobsQueue.add(
        "ai-jobs",
        { jobType: PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE, payload: { photoId: photo.id } },
        { jobId: `photo-analysis-${photo.id}`, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } }
      );
    } catch (queueError) {
      console.warn(`Failed to queue photo analysis for ${photo.id} at intake finalization:`, queueError);
    }
  }

  return {
    ok: true,
    projectId: project.id,
    status: "submitted",
    message: "Intake finalized. Preliminary quote generation is scheduled.",
  };
}
