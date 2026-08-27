/**
 * FR-4.3: post-estimate admin override. Once a quote exists, an admin can
 * adjust pricing, modification scope, and grant eligibility together in one
 * submission. Unlike the pre-estimate override (modificationOverride.ts),
 * this never re-triggers AI re-estimation/re-evaluation — once a client has
 * seen a number, the admin's entered values are authoritative until someone
 * explicitly re-runs AI via /api/admin/eligibility/assess.
 *
 * Pricing/scope/eligibility are stored on a QuoteOverride row layered on top
 * of the immutable Quote/EligibilityAssessment rows rather than mutating
 * them in place, so "what the AI actually produced" stays intact for audit
 * purposes. resolveEffectiveQuoteView merges the two for display.
 */
import { EligibilityDecision, Prisma } from "@prisma/client";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  aggregateDeclaredModificationCodes,
  InvalidPhotoModificationsError,
  validatePhotoModifications,
} from "@/backend/eligibility/modificationNormalization";
import type { ModificationCode } from "@/backend/eligibility/types";
import type { DiscoveredGrant, GrantDiscoveryScope } from "@/backend/eligibility/discoverySearchProvider";
import { DEFAULT_PRICING_TIER, isTieredEstimate, type AnyRefinedEstimate } from "@/backend/services/pricingTiers";

export const QUOTE_OVERRIDE_AUDIT_ACTION = "QUOTE_POST_ESTIMATE_OVERRIDE";

const GRANT_OVERRIDE_DECISIONS = [EligibilityDecision.ELIGIBLE, EligibilityDecision.INELIGIBLE] as const;
type GrantOverrideDecision = (typeof GRANT_OVERRIDE_DECISIONS)[number];

const GRANT_SCOPES: GrantDiscoveryScope[] = ["MUNICIPAL", "PROVINCIAL", "NATIONAL"];

export type QuoteOverrideErrorCode =
  | "PROJECT_NOT_FOUND"
  | "QUOTE_NOT_FOUND"
  | "INVALID_PHOTO_MODIFICATIONS"
  | "INVALID_PRICING"
  | "INVALID_ELIGIBILITY_DECISION"
  | "INVALID_GRANT_CHANGES"
  | "MISSING_REASON";

export class QuoteOverrideError extends Error {
  statusCode: number;
  code: QuoteOverrideErrorCode;

  constructor(message: string, statusCode: number, code: QuoteOverrideErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function quoteNotFoundError(): QuoteOverrideError {
  return new QuoteOverrideError(
    "No estimate has been generated for this project yet. Use the pre-estimate modification override instead.",
    409,
    "QUOTE_NOT_FOUND"
  );
}

export interface QuoteOverrideLineItem {
  description: string;
  quantity: number;
  materialTotal: number;
  laborTotal: number;
}

export interface QuoteOverridePricing {
  lineItems: QuoteOverrideLineItem[];
  subtotal: number;
  total: number;
}

export interface GrantDecisionOverride {
  grantId: string;
  decision: GrantOverrideDecision;
}

export interface AddedGrant {
  id: string;
  title: string;
  scope: GrantDiscoveryScope;
  jurisdiction: string;
  decision: GrantOverrideDecision;
  note: string | null;
}

export interface GrantOverrides {
  removedGrantIds: string[];
  decisionOverrides: GrantDecisionOverride[];
  addedGrants: AddedGrant[];
}

export interface EffectiveGrant {
  grantId: string;
  title: string;
  scope: string;
  jurisdiction: string;
  decision: string;
  source: "ai" | "admin_added";
  sourceUrl?: string | null;
  summary?: string;
  relevanceScore?: number;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  note?: string | null;
}

export interface EffectiveQuoteView {
  subtotal: number;
  total: number;
  lineItems: QuoteOverrideLineItem[];
  modificationCodes: ModificationCode[];
  eligibilityDecision: EligibilityDecision | null;
  discoveredGrants: EffectiveGrant[];
  isOverridden: boolean;
}

function validatePricing(input: unknown): QuoteOverridePricing {
  if (!input || typeof input !== "object") {
    throw new QuoteOverrideError("pricing is required", 400, "INVALID_PRICING");
  }

  const { lineItems, subtotal, total } = input as {
    lineItems?: unknown;
    subtotal?: unknown;
    total?: unknown;
  };

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new QuoteOverrideError("pricing.lineItems must be a non-empty array", 400, "INVALID_PRICING");
  }

  const validatedLineItems: QuoteOverrideLineItem[] = lineItems.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new QuoteOverrideError(`pricing.lineItems[${index}] is invalid`, 400, "INVALID_PRICING");
    }
    const item = raw as Record<string, unknown>;
    const { description, quantity, materialTotal, laborTotal } = item;

    if (typeof description !== "string" || !description.trim()) {
      throw new QuoteOverrideError(
        `pricing.lineItems[${index}].description must be a non-empty string`,
        400,
        "INVALID_PRICING"
      );
    }
    for (const [field, value] of [
      ["quantity", quantity],
      ["materialTotal", materialTotal],
      ["laborTotal", laborTotal],
    ] as const) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new QuoteOverrideError(
          `pricing.lineItems[${index}].${field} must be a non-negative number`,
          400,
          "INVALID_PRICING"
        );
      }
    }

    return {
      description: description.trim(),
      quantity: quantity as number,
      materialTotal: materialTotal as number,
      laborTotal: laborTotal as number,
    };
  });

  if (typeof subtotal !== "number" || !Number.isFinite(subtotal) || subtotal < 0) {
    throw new QuoteOverrideError("pricing.subtotal must be a non-negative number", 400, "INVALID_PRICING");
  }
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new QuoteOverrideError("pricing.total must be a non-negative number", 400, "INVALID_PRICING");
  }

  return { lineItems: validatedLineItems, subtotal, total };
}

function validateEligibilityDecision(input: unknown): EligibilityDecision {
  if (typeof input !== "string" || !(Object.values(EligibilityDecision) as string[]).includes(input)) {
    throw new QuoteOverrideError(
      `eligibilityDecision must be one of ${Object.values(EligibilityDecision).join(", ")}`,
      400,
      "INVALID_ELIGIBILITY_DECISION"
    );
  }
  return input as EligibilityDecision;
}

function validateGrantChanges(input: unknown, availableGrantIds: Set<string>): GrantOverrides {
  const raw = (input ?? {}) as Record<string, unknown>;
  const removedGrantIdsRaw = raw.removedGrantIds ?? [];
  const decisionOverridesRaw = raw.decisionOverrides ?? [];
  const addedGrantsRaw = raw.addedGrants ?? [];

  if (!Array.isArray(removedGrantIdsRaw) || !removedGrantIdsRaw.every((id) => typeof id === "string")) {
    throw new QuoteOverrideError("grantChanges.removedGrantIds must be an array of strings", 400, "INVALID_GRANT_CHANGES");
  }
  for (const grantId of removedGrantIdsRaw) {
    if (!availableGrantIds.has(grantId)) {
      throw new QuoteOverrideError(`Unknown grantId in removedGrantIds: ${grantId}`, 400, "INVALID_GRANT_CHANGES");
    }
  }

  if (!Array.isArray(decisionOverridesRaw)) {
    throw new QuoteOverrideError("grantChanges.decisionOverrides must be an array", 400, "INVALID_GRANT_CHANGES");
  }
  const decisionOverrides: GrantDecisionOverride[] = decisionOverridesRaw.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new QuoteOverrideError(`grantChanges.decisionOverrides[${index}] is invalid`, 400, "INVALID_GRANT_CHANGES");
    }
    const { grantId, decision } = raw as Record<string, unknown>;
    if (typeof grantId !== "string" || !availableGrantIds.has(grantId)) {
      throw new QuoteOverrideError(
        `grantChanges.decisionOverrides[${index}].grantId is not a known grant`,
        400,
        "INVALID_GRANT_CHANGES"
      );
    }
    if (!GRANT_OVERRIDE_DECISIONS.includes(decision as GrantOverrideDecision)) {
      throw new QuoteOverrideError(
        `grantChanges.decisionOverrides[${index}].decision must be ELIGIBLE or INELIGIBLE`,
        400,
        "INVALID_GRANT_CHANGES"
      );
    }
    return { grantId, decision: decision as GrantOverrideDecision };
  });

  if (!Array.isArray(addedGrantsRaw)) {
    throw new QuoteOverrideError("grantChanges.addedGrants must be an array", 400, "INVALID_GRANT_CHANGES");
  }
  const addedGrants: AddedGrant[] = addedGrantsRaw.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new QuoteOverrideError(`grantChanges.addedGrants[${index}] is invalid`, 400, "INVALID_GRANT_CHANGES");
    }
    const { title, scope, jurisdiction, decision, note } = raw as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim()) {
      throw new QuoteOverrideError(`grantChanges.addedGrants[${index}].title is required`, 400, "INVALID_GRANT_CHANGES");
    }
    if (typeof scope !== "string" || !GRANT_SCOPES.includes(scope as GrantDiscoveryScope)) {
      throw new QuoteOverrideError(
        `grantChanges.addedGrants[${index}].scope must be one of ${GRANT_SCOPES.join(", ")}`,
        400,
        "INVALID_GRANT_CHANGES"
      );
    }
    if (typeof jurisdiction !== "string" || !jurisdiction.trim()) {
      throw new QuoteOverrideError(
        `grantChanges.addedGrants[${index}].jurisdiction is required`,
        400,
        "INVALID_GRANT_CHANGES"
      );
    }
    if (!GRANT_OVERRIDE_DECISIONS.includes(decision as GrantOverrideDecision)) {
      throw new QuoteOverrideError(
        `grantChanges.addedGrants[${index}].decision must be ELIGIBLE or INELIGIBLE`,
        400,
        "INVALID_GRANT_CHANGES"
      );
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new QuoteOverrideError(`grantChanges.addedGrants[${index}].note must be a string`, 400, "INVALID_GRANT_CHANGES");
    }

    return {
      id: `manual-${cuid()}`,
      title: title.trim(),
      scope: scope as GrantDiscoveryScope,
      jurisdiction: jurisdiction.trim(),
      decision: decision as GrantOverrideDecision,
      note: (note as string | null | undefined)?.trim() || null,
    };
  });

  return { removedGrantIds: removedGrantIdsRaw, decisionOverrides, addedGrants };
}

// Lightweight cuid-ish id generator for admin-added grants — collision risk
// is irrelevant here (these ids only need to be unique within one project's
// grant list), so we avoid adding a dependency for it.
function cuid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalizes raw AI-discovered grants into the EffectiveGrant shape, with no
 * override applied. Exported so callers with an EligibilityAssessment but no
 * Quote yet (grant discovery can complete before pricing does) can render
 * the same shape as resolveEffectiveQuoteView's output instead of a
 * differently-shaped ad hoc projection.
 */
export function mapAiGrantsToEffectiveGrants(grants: DiscoveredGrant[]): EffectiveGrant[] {
  return grants.map((grant) => ({
    grantId: grant.grantId,
    title: grant.title,
    scope: grant.scope,
    jurisdiction: grant.jurisdiction,
    decision: grant.decision,
    source: "ai" as const,
    sourceUrl: grant.sourceUrl,
    summary: grant.summary,
    relevanceScore: grant.relevanceScore,
    confidence: grant.confidence,
  }));
}

/**
 * Applies removedGrantIds/decisionOverrides/addedGrants on top of a raw
 * DiscoveredGrant[] list while preserving every AI-only field (sourceUrl,
 * summary, matchedCriteria, missingCriteria, rationale, ...) that richer
 * client-facing consumers (e.g. GrantDiscoverySummary.tsx) render but the
 * admin-facing EffectiveGrant projection deliberately drops. Admin-added
 * grants get safe placeholder values for the AI-only fields since they have
 * no discovery data behind them.
 */
export function applyGrantOverridesToRawGrants(
  grants: DiscoveredGrant[],
  grantOverrides: GrantOverrides | null | undefined
): DiscoveredGrant[] {
  if (!grantOverrides) return grants;

  const removedGrantIds = new Set(grantOverrides.removedGrantIds ?? []);
  const decisionOverridesByGrantId = new Map(
    (grantOverrides.decisionOverrides ?? []).map((d) => [d.grantId, d.decision])
  );

  const kept: DiscoveredGrant[] = grants
    .filter((grant) => !removedGrantIds.has(grant.grantId))
    .map((grant) => ({
      ...grant,
      decision: (decisionOverridesByGrantId.get(grant.grantId) ?? grant.decision) as DiscoveredGrant["decision"],
    }));

  const added: DiscoveredGrant[] = (grantOverrides.addedGrants ?? []).map((grant) => ({
    grantId: grant.id,
    title: grant.title,
    scope: grant.scope,
    jurisdiction: grant.jurisdiction,
    sourceUrl: null,
    summary: grant.note ?? "Added by the advisory team.",
    decision: grant.decision as DiscoveredGrant["decision"],
    relevanceScore: 100,
    confidence: "HIGH",
    matchedCriteria: [],
    missingCriteria: [],
    rationale: grant.note ?? "Manually added by the advisory team.",
    estimatedFundingAmount: null,
  }));

  return [...kept, ...added];
}

/**
 * Merges a Quote's raw AI-generated pricing/eligibility with any
 * QuoteOverride layered on top of it. This is the single place every read
 * path (admin dashboard, client estimate page, eligibility API) should call
 * into, so overrides don't need bespoke merge logic scattered around.
 */
export function resolveEffectiveQuoteView(
  quote: {
    subtotal: unknown;
    total: unknown;
    refinedEstimate?: unknown;
  },
  override: {
    subtotal: unknown;
    total: unknown;
    lineItems: unknown;
    modificationCodes: unknown;
    eligibilityDecision: EligibilityDecision;
    grantOverrides: unknown;
  } | null,
  assessment: { overallDecision: EligibilityDecision; discoveredGrants: unknown } | null,
  rawModificationCodes: ModificationCode[]
): EffectiveQuoteView {
  const aiGrants: DiscoveredGrant[] = Array.isArray(assessment?.discoveredGrants)
    ? (assessment!.discoveredGrants as DiscoveredGrant[])
    : [];

  if (!override) {
    const rawRefinedEstimate = quote.refinedEstimate as AnyRefinedEstimate | null | undefined;
    const refined = isTieredEstimate(rawRefinedEstimate)
      ? rawRefinedEstimate.tiers[rawRefinedEstimate.selectedTier ?? DEFAULT_PRICING_TIER]
      : rawRefinedEstimate;
    return {
      subtotal: Number(quote.subtotal),
      total: Number(quote.total),
      lineItems: refined?.lineItems ?? [],
      modificationCodes: rawModificationCodes,
      eligibilityDecision: assessment?.overallDecision ?? null,
      discoveredGrants: mapAiGrantsToEffectiveGrants(aiGrants),
      isOverridden: false,
    };
  }

  const grantOverrides = override.grantOverrides as GrantOverrides;
  const removedGrantIds = new Set(grantOverrides?.removedGrantIds ?? []);
  const decisionOverridesByGrantId = new Map(
    (grantOverrides?.decisionOverrides ?? []).map((d) => [d.grantId, d.decision])
  );

  const effectiveAiGrants: EffectiveGrant[] = mapAiGrantsToEffectiveGrants(
    aiGrants.filter((grant) => !removedGrantIds.has(grant.grantId))
  ).map((grant) => ({
    ...grant,
    decision: decisionOverridesByGrantId.get(grant.grantId) ?? grant.decision,
  }));

  const addedGrants: EffectiveGrant[] = (grantOverrides?.addedGrants ?? []).map((grant) => ({
    grantId: grant.id,
    title: grant.title,
    scope: grant.scope,
    jurisdiction: grant.jurisdiction,
    decision: grant.decision,
    source: "admin_added" as const,
    note: grant.note,
  }));

  return {
    subtotal: Number(override.subtotal),
    total: Number(override.total),
    lineItems: override.lineItems as QuoteOverrideLineItem[],
    modificationCodes: override.modificationCodes as ModificationCode[],
    eligibilityDecision: override.eligibilityDecision,
    discoveredGrants: [...effectiveAiGrants, ...addedGrants],
    isOverridden: true,
  };
}

export interface OverridePostEstimateQuoteInput {
  projectId: string;
  actorUserId: string;
  photoModifications: unknown;
  pricing: unknown;
  eligibilityDecision: unknown;
  grantChanges?: unknown;
  reason: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface OverridePostEstimateQuoteResult {
  projectId: string;
  quoteId: string;
  effective: EffectiveQuoteView;
  totalChanged: boolean;
}

export async function overridePostEstimateQuote(
  input: OverridePostEstimateQuoteInput
): Promise<OverridePostEstimateQuoteResult> {
  if (typeof input.reason !== "string" || !input.reason.trim()) {
    throw new QuoteOverrideError("reason is required for a post-estimate override", 400, "MISSING_REASON");
  }
  const reason = input.reason.trim();

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      photos: { select: { id: true, declaredModificationCodes: true } },
      quotes: {
        orderBy: { generatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          subtotal: true,
          total: true,
          refinedEstimate: true,
          eligibilityAssessmentId: true,
          override: true,
        },
      },
    },
  });

  if (!project) {
    throw new QuoteOverrideError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const quote = project.quotes[0];
  if (!quote) {
    throw quoteNotFoundError();
  }

  const assessment = quote.eligibilityAssessmentId
    ? await prisma.eligibilityAssessment.findUnique({
        where: { id: quote.eligibilityAssessmentId },
        select: { overallDecision: true, discoveredGrants: true },
      })
    : null;

  const photosById = new Map(project.photos.map((p) => [p.id, p]));
  let photoEntries;
  try {
    photoEntries = validatePhotoModifications(input.photoModifications, new Set(photosById.keys()));
  } catch (error) {
    if (error instanceof InvalidPhotoModificationsError) {
      throw new QuoteOverrideError(error.message, 400, "INVALID_PHOTO_MODIFICATIONS");
    }
    throw error;
  }

  const pricing = validatePricing(input.pricing);
  const eligibilityDecision = validateEligibilityDecision(input.eligibilityDecision);

  const aiGrantIds = new Set(
    Array.isArray(assessment?.discoveredGrants)
      ? (assessment!.discoveredGrants as unknown as DiscoveredGrant[]).map((g) => g.grantId)
      : []
  );
  const grantChanges = validateGrantChanges(input.grantChanges, aiGrantIds);

  const beforeView = resolveEffectiveQuoteView(
    quote,
    quote.override,
    assessment,
    aggregateDeclaredModificationCodes(project.photos)
  );

  const previousTotal = beforeView.total;

  let raceLost = false;
  let newModificationCodes: ModificationCode[] = [];
  await prisma.$transaction(async (tx) => {
    const current = await tx.project.findUnique({
      where: { id: project.id },
      select: { quotes: { orderBy: { generatedAt: "desc" }, take: 1, select: { id: true } } },
    });

    if (!current || current.quotes[0]?.id !== quote.id) {
      raceLost = true;
      return;
    }

    for (const entry of photoEntries) {
      await tx.photo.update({
        where: { id: entry.photoId },
        data: { declaredModificationCodes: entry.declaredModificationCodes },
      });
    }

    const allPhotosAfterUpdate = await tx.photo.findMany({
      where: { projectId: project.id },
      select: { declaredModificationCodes: true },
    });
    newModificationCodes = aggregateDeclaredModificationCodes(allPhotosAfterUpdate);

    const overrideFields = {
      overriddenByUserId: input.actorUserId,
      reason,
      subtotal: pricing.subtotal,
      total: pricing.total,
      previousTotal,
      lineItems: pricing.lineItems as unknown as Prisma.InputJsonValue,
      modificationCodes: newModificationCodes as unknown as Prisma.InputJsonValue,
      eligibilityDecision,
      grantOverrides: grantChanges as unknown as Prisma.InputJsonValue,
    };

    await tx.quoteOverride.upsert({
      where: { quoteId: quote.id },
      create: { quoteId: quote.id, ...overrideFields },
      update: overrideFields,
    });
  });

  if (raceLost) {
    throw quoteNotFoundError();
  }

  const afterView: EffectiveQuoteView = {
    subtotal: pricing.subtotal,
    total: pricing.total,
    lineItems: pricing.lineItems,
    modificationCodes: newModificationCodes,
    eligibilityDecision,
    discoveredGrants: resolveEffectiveQuoteView(
      quote,
      {
        subtotal: pricing.subtotal,
        total: pricing.total,
        lineItems: pricing.lineItems,
        modificationCodes: newModificationCodes,
        eligibilityDecision,
        grantOverrides: grantChanges,
      },
      assessment,
      newModificationCodes
    ).discoveredGrants,
    isOverridden: true,
  };

  const totalChanged = afterView.total !== previousTotal;

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: QUOTE_OVERRIDE_AUDIT_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    quoteId: quote.id,
    resourceType: "quote",
    resourceId: quote.id,
    description: "Admin overrode pricing, modification scope, and/or grant eligibility after estimate generation",
    beforeState: beforeView,
    afterState: afterView,
    reason,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    projectId: project.id,
    quoteId: quote.id,
    effective: afterView,
    totalChanged,
  };
}
