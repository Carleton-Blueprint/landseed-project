/**
 * FR-4.10: delayed quote generation. finalizeIntake schedules a job on this
 * module's queue instead of generating a quote inline, so admins/advisory have
 * a window to override modification type/scope before pricing runs.
 */
import { prisma } from "lib/prisma";
import { generateQuote } from "@/backend/services/quote";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { ESTIMATE_READY_TRIGGER_SOURCE } from "@/backend/notifications/estimateReadyContract";

export const ESTIMATE_GENERATION_DELAY_MINUTES_ENV = "ESTIMATE_GENERATION_DELAY_MINUTES";
export const DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES = 15;
export const MAX_ESTIMATE_GENERATION_DELAY_MINUTES = 24 * 60;

export function getEstimateGenerationDelayMinutes(): number {
  const raw = process.env[ESTIMATE_GENERATION_DELAY_MINUTES_ENV];
  if (!raw) {
    return DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ESTIMATE_GENERATION_DELAY_MINUTES;
  }

  return Math.min(parsed, MAX_ESTIMATE_GENERATION_DELAY_MINUTES);
}

export function getEstimateGenerationDelayMs(): number {
  return getEstimateGenerationDelayMinutes() * 60 * 1000;
}

export function buildEstimateGenerationJobId(projectId: string): string {
  return `estimate-generation:${projectId}`;
}

export function buildQuoteItems(
  draftData: unknown
): Array<{ description: string; quantity: number; unitPrice: number }> {
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

export interface ProcessScheduledEstimateGenerationInput {
  projectId: string;
  actorUserId?: string;
}

export type ProcessScheduledEstimateGenerationStatus =
  | "generated"
  | "skipped_quote_exists"
  | "skipped_project_not_submitted";

export interface ProcessScheduledEstimateGenerationResult {
  projectId: string;
  status: ProcessScheduledEstimateGenerationStatus;
  quoteId?: string;
}

export async function processScheduledEstimateGeneration(
  input: ProcessScheduledEstimateGenerationInput
): Promise<ProcessScheduledEstimateGenerationResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
      draftData: true,
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!project) {
    return { projectId: input.projectId, status: "skipped_project_not_submitted" };
  }

  const existingQuote = project.quotes[0];
  if (existingQuote) {
    return { projectId: project.id, status: "skipped_quote_exists", quoteId: existingQuote.id };
  }

  if (project.status !== "submitted") {
    return { projectId: project.id, status: "skipped_project_not_submitted" };
  }

  const quoteItems = buildQuoteItems(project.draftData);

  const quoteResult = await generateQuote({
    projectId: project.id,
    items: quoteItems,
  });

  await markEstimateReadyForReview({
    projectId: project.id,
    quoteId: quoteResult.quoteId,
    triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.DELAYED_ESTIMATE_GENERATION,
    actorUserId: input.actorUserId,
  });

  return { projectId: project.id, status: "generated", quoteId: quoteResult.quoteId };
}
