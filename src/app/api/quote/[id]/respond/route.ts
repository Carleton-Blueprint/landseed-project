import { NextRequest, NextResponse } from "next/server";
import { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import {
  isTieredEstimate,
  PRICING_TIER_KEYS,
  type AnyRefinedEstimate,
  type PricingTierKey,
  type TieredRefinedEstimate,
} from "@/backend/services/pricingTiers";

function isPricingTierKey(value: unknown): value is PricingTierKey {
  return typeof value === "string" && (PRICING_TIER_KEYS as readonly string[]).includes(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestContext = getRequestAuditContext(req);
  const resolvedParams = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Unauthenticated quote response attempt",
        ...requestContext,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { status, reason, survey, selectedTier } = body;

    // Validate inputs
    if (status !== "ACCEPTED" && status !== "DECLINED") {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Rejected estimate status update due to invalid status",
        metadata: { providedStatus: status },
        ...requestContext,
      });
      return NextResponse.json({ error: "Invalid status provided" }, { status: 400 });
    }
    if (status === "DECLINED" && (!reason || typeof reason !== "string")) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Rejected decline update due to missing reason",
        metadata: { providedReasonType: typeof reason },
        ...requestContext,
      });
      return NextResponse.json({ error: "A valid reason is required when declining" }, { status: 400 });
    }
    if (status === "DECLINED" && survey && typeof survey === "object") {
      if (!survey.primaryReason || typeof survey.primaryReason !== "string") {
        return NextResponse.json({ error: "Survey primaryReason is required" }, { status: 400 });
      }
    }

    // Fetch the quote and its related project access
    const quote = await prisma.quote.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            projectAccess: {
              where: { userId: session.user.id }
            }
          }
        }
      }
    });

    if (!quote) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        quoteId: resolvedParams.id,
        resourceType: "quote",
        resourceId: resolvedParams.id,
        description: "Quote response attempted for non-existent quote",
        ...requestContext,
      });
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Check if the user has access to this project
    if (quote.project.projectAccess.length === 0) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "QUOTE_RESPONSE_ATTEMPT",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Quote response denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json({ error: "Forbidden: You don't have access to this quote" }, { status: 403 });
    }

    const refinedEstimate = quote.refinedEstimate as unknown as AnyRefinedEstimate | null;
    const quoteIsTiered = !!refinedEstimate && isTieredEstimate(refinedEstimate);

    if (status === "ACCEPTED" && quoteIsTiered && !isPricingTierKey(selectedTier)) {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "ESTIMATE_STATUS_CHANGE",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId: quote.projectId,
        quoteId: quote.id,
        resourceType: "quote",
        resourceId: quote.id,
        description: "Rejected acceptance of tiered estimate due to missing/invalid selectedTier",
        metadata: { providedSelectedTier: selectedTier },
        ...requestContext,
      });
      return NextResponse.json(
        { error: "A valid selectedTier is required to accept a tiered estimate" },
        { status: 400 }
      );
    }

    const acceptedTier: PricingTierKey | null =
      status === "ACCEPTED" && quoteIsTiered ? (selectedTier as PricingTierKey) : null;

    // Process the update
    const updatedProjectStatus = status === "ACCEPTED" ? ProjectStatus.ESTIMATE_ACCEPTED : ProjectStatus.ESTIMATE_DECLINED;

    // Update Quote status and Project status in a transaction
    const updatedQuote = await prisma.$transaction(async (tx) => {
      const updatedRows = await tx.$queryRaw<Array<{ id: string; status: string; declinedReason: string | null }>>(
        Prisma.sql`
          UPDATE "Quote"
          SET
            "status" = ${status}::"QuoteStatus",
            "declinedReason" = ${status === "DECLINED" ? reason : null},
            "lastClientActivityAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${quote.id}
          RETURNING "id", "status", "declinedReason"
        `
      );

      await tx.project.update({
        where: { id: quote.projectId },
        data: {
          status: updatedProjectStatus,
          // Optional: we can store structured decline data in project draftData too
        }
      });

      if (updatedRows.length === 0) {
        throw new Error("Quote update failed");
      }

      // Persist structured decline survey if provided
      if (status === "DECLINED" && survey && typeof survey === "object") {
        await tx.declineSurveyResponse.upsert({
          where: { quoteId: quote.id },
          create: {
            quoteId: quote.id,
            primaryReason: survey.primaryReason,
            subReasons: Array.isArray(survey.subReasons) ? survey.subReasons : null,
            satisfactionRating: typeof survey.satisfactionRating === "number" ? survey.satisfactionRating : null,
            additionalComments: typeof survey.additionalComments === "string" ? survey.additionalComments : null,
            wouldReconsider: survey.wouldReconsider === true,
          },
          update: {
            primaryReason: survey.primaryReason,
            subReasons: Array.isArray(survey.subReasons) ? survey.subReasons : null,
            satisfactionRating: typeof survey.satisfactionRating === "number" ? survey.satisfactionRating : null,
            additionalComments: typeof survey.additionalComments === "string" ? survey.additionalComments : null,
            wouldReconsider: survey.wouldReconsider === true,
          },
        });
      }

      if (status === "ACCEPTED" && quoteIsTiered && acceptedTier) {
        const tieredEstimate = refinedEstimate as TieredRefinedEstimate;

        await tx.quote.update({
          where: { id: quote.id },
          data: {
            refinedEstimate: {
              ...tieredEstimate,
              selectedTier: acceptedTier,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        ...updatedRows[0],
        selectedTier: acceptedTier,
      };
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_STATUS_CHANGE",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId: quote.projectId,
      quoteId: quote.id,
      resourceType: "quote",
      resourceId: quote.id,
      reason: status === "DECLINED" ? reason : null,
      description: "Manual estimate status updated",
      beforeState: {
        projectStatus: quote.project.status,
      },
      afterState: {
        status: updatedQuote.status,
        declinedReason: updatedQuote.declinedReason,
        projectStatus: updatedProjectStatus,
      },
      ...requestContext,
    });

    return NextResponse.json({ success: true, quote: updatedQuote }, { status: 200 });
  } catch (error: unknown) {
    console.error("Quote response error:", error);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ESTIMATE_STATUS_CHANGE",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      quoteId: resolvedParams.id,
      resourceType: "quote",
      resourceId: resolvedParams.id,
      description: "Estimate status update failed due to internal error",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      ...requestContext,
    });

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
