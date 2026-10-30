/**
 * Loads who overrode/re-assessed a project's eligibility or pricing, and when.
 * Batched by project id so the admin dashboard makes three queries total
 * rather than three per project. No schema of its own: reads the latest
 * EligibilityAssessment (source/adminAction/createdByUser), the latest
 * quote's QuoteOverride, and that quote's QUOTE_OVERRIDE_AUDIT_ACTION audit
 * entries (QuoteOverride is one upserted row per quote, so earlier overriders
 * only survive in the audit log).
 */

import { prisma } from "lib/prisma";
import { QUOTE_OVERRIDE_AUDIT_ACTION } from "@/backend/services/quoteOverride";
import {
  displayStaffName,
  type AdminAssessmentAttribution,
  type OverrideAttribution,
  type PostEstimateOverrideAttribution,
} from "@/backend/services/overrideAttributionLabels";

const STAFF_NAME_SELECT = { select: { name: true, email: true } } as const;

const NO_ATTRIBUTION: OverrideAttribution = {
  assessment: null,
  postEstimateOverride: null,
  clientOverridden: false,
};

export async function getOverrideAttributions(projectIds: string[]): Promise<Map<string, OverrideAttribution>> {
  const result = new Map<string, OverrideAttribution>();
  if (projectIds.length === 0) return result;

  const [assessments, quotes] = await Promise.all([
    prisma.eligibilityAssessment.findMany({
      where: { projectId: { in: projectIds }, isLatest: true },
      select: {
        projectId: true,
        source: true,
        adminAction: true,
        createdAt: true,
        createdByUser: STAFF_NAME_SELECT,
      },
    }),
    prisma.quote.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        projectId: true,
        createdAt: true,
        override: { select: { updatedAt: true, overriddenByUser: STAFF_NAME_SELECT } },
      },
    }),
  ]);

  const firstQuoteByProject = new Map<string, (typeof quotes)[number]>();
  const latestQuoteByProject = new Map<string, (typeof quotes)[number]>();
  for (const quote of quotes) {
    if (!firstQuoteByProject.has(quote.projectId)) firstQuoteByProject.set(quote.projectId, quote);
    latestQuoteByProject.set(quote.projectId, quote);
  }

  const overriddenQuoteIds = [...latestQuoteByProject.values()].filter((q) => q.override).map((q) => q.id);
  const auditEntries = overriddenQuoteIds.length
    ? await prisma.auditEvent.findMany({
        where: { action: QUOTE_OVERRIDE_AUDIT_ACTION, outcome: "SUCCESS", quoteId: { in: overriddenQuoteIds } },
        orderBy: { createdAt: "desc" },
        select: { quoteId: true, createdAt: true, actorUser: STAFF_NAME_SELECT },
      })
    : [];

  const historyByQuote = new Map<string, PostEstimateOverrideAttribution["history"]>();
  for (const entry of auditEntries) {
    if (!entry.quoteId) continue;
    const history = historyByQuote.get(entry.quoteId) ?? [];
    history.push({ adminName: displayStaffName(entry.actorUser), at: entry.createdAt.toISOString() });
    historyByQuote.set(entry.quoteId, history);
  }

  const assessmentByProject = new Map(assessments.map((a) => [a.projectId, a]));

  for (const projectId of projectIds) {
    const latestAssessment = assessmentByProject.get(projectId);
    const firstQuote = firstQuoteByProject.get(projectId);
    const latestQuote = latestQuoteByProject.get(projectId);

    let assessment: AdminAssessmentAttribution | null = null;
    if (latestAssessment?.source === "ADMIN" && latestAssessment.adminAction) {
      assessment = {
        adminAction: latestAssessment.adminAction,
        adminName: displayStaffName(latestAssessment.createdByUser),
        at: latestAssessment.createdAt.toISOString(),
        stage: firstQuote && latestAssessment.createdAt >= firstQuote.createdAt ? "post-estimate" : "pre-estimate",
      };
    }

    let postEstimateOverride: PostEstimateOverrideAttribution | null = null;
    if (latestQuote?.override) {
      const history = historyByQuote.get(latestQuote.id) ?? [];
      postEstimateOverride = {
        adminName: displayStaffName(latestQuote.override.overriddenByUser),
        at: latestQuote.override.updatedAt.toISOString(),
        editCount: Math.max(history.length, 1),
        history,
      };
    }

    result.set(projectId, {
      assessment,
      postEstimateOverride,
      clientOverridden: postEstimateOverride !== null,
    });
  }

  return result;
}

export async function getOverrideAttribution(projectId: string): Promise<OverrideAttribution> {
  return (await getOverrideAttributions([projectId])).get(projectId) ?? NO_ATTRIBUTION;
}
