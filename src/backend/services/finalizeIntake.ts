import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { generateQuote } from "@/backend/services/quote";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { ESTIMATE_READY_TRIGGER_SOURCE } from "@/backend/notifications/estimateReadyContract";

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

function getPricingSourceFromRefinedEstimate(refinedEstimate: unknown): PreliminaryRange["source"] {
  if (!refinedEstimate || typeof refinedEstimate !== "object" || Array.isArray(refinedEstimate)) {
    return "serp_api_partial";
  }

  const lineItems = (refinedEstimate as { lineItems?: Array<{ pricingSource?: string | null }> }).lineItems ?? [];
  if (lineItems.length === 0) {
    return "serp_api_partial";
  }

  const allSerpSourced = lineItems.every((item) => item.pricingSource !== null);
  return allSerpSourced ? "serp_api" : "serp_api_partial";
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

function buildQuoteItems(draftData: unknown): Array<{ description: string; quantity: number; unitPrice: number }> {
  const modificationItems =
    draftData && typeof draftData === "object" && !Array.isArray(draftData)
      ? (draftData as { modificationItems?: unknown }).modificationItems
      : undefined;

  if (!Array.isArray(modificationItems) || modificationItems.length === 0) {
    return [
      {
        description: "Home modifications (initial intake estimate)",
        quantity: 1,
        unitPrice: 150,
      },
    ];
  }

  return modificationItems.map((item) => ({
    description: typeof item === "string" ? item : String(item),
    quantity: 1,
    unitPrice: 150,
  }));
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

  const quoteItems = buildQuoteItems(project.draftData);

  try {
    const quoteResult = await generateQuote({
      projectId: project.id,
      items: quoteItems,
    });

    const pricingSource = getPricingSourceFromRefinedEstimate(quoteResult.refinedEstimate);
    const range: PreliminaryRange = {
      min: quoteResult.estimateMin,
      max: quoteResult.estimateMax,
      source: pricingSource,
      generatedAt: new Date().toISOString(),
    };

    try {
      const readyResult = await markEstimateReadyForReview({
        projectId: project.id,
        quoteId: quoteResult.quoteId,
        triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.LEGACY_QUOTE_GENERATION,
        actorUserId: input.actorUserId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return {
        ok: true,
        projectId: project.id,
        status: readyResult.projectStatus === "estimate_ready" ? "estimate_ready" : "submitted",
        quoteId: quoteResult.quoteId,
        range,
        message: "Intake finalized, preliminary quote generated, and estimate marked ready.",
      };
    } catch (readyError) {
      console.warn("Estimate ready transition failed after quote generation:", readyError);
      return {
        ok: true,
        projectId: project.id,
        status: "submitted",
        quoteId: quoteResult.quoteId,
        range,
        message: "Intake finalized and preliminary quote generated.",
      };
    }
  } catch (quoteError) {
    console.warn("Quote generation failed after intake finalization:", quoteError);

    return {
      ok: true,
      projectId: project.id,
      status: "submitted",
      message: "Intake finalized successfully. Preliminary quote generation is pending.",
    };
  }
}
