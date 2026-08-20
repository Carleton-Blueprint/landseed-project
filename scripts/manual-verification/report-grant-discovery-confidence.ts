/**
 * Manual verification script: Phase 4 of the "Email Service Validation and
 * Grant Discovery AI Verification" ticket — aggregates confidence scores
 * and source references across real EligibilityAssessment rows (not just
 * the synthetic ground-truth runs in Phase 3), and retroactively checks
 * every assessment against detectCatalogContradictions() to see whether
 * any existing production data already has the discrepancy pattern found
 * during Phase 3 (see docs/grant-discovery-verification-2026-08-14.md).
 *
 * Read-only — queries the DB, does not write anything.
 *
 * Usage: npx tsx scripts/manual-verification/report-grant-discovery-confidence.ts
 */
import "dotenv/config";
import { prisma } from "lib/prisma";
import { assembleEligibilityInput } from "@/backend/eligibility/assembler";
import { detectCatalogContradictions, DiscoveredGrant } from "@/backend/eligibility/discoverySearchProvider";

async function main() {
  const assessments = await prisma.eligibilityAssessment.findMany({
    where: { isLatest: true },
    select: {
      id: true,
      projectId: true,
      discoveredGrants: true,
      discoveryProvider: true,
      createdAt: true,
      project: {
        select: {
          id: true,
          status: true,
          address: true,
          draftData: true,
          photos: { select: { declaredModificationCodes: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`=== ${assessments.length} latest EligibilityAssessment row(s) ===\n`);

  const providerCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const grantFrequency: Record<string, { title: string; count: number; confidences: Record<string, number> }> = {};
  let totalGrants = 0;
  let assessmentsWithNoGrants = 0;

  const contradictionsFound: { projectId: string; address: string; assessmentId: string; grants: string[] }[] = [];

  for (const assessment of assessments) {
    providerCounts[assessment.discoveryProvider ?? "UNKNOWN"] = (providerCounts[assessment.discoveryProvider ?? "UNKNOWN"] ?? 0) + 1;

    const grants = (assessment.discoveredGrants as unknown as DiscoveredGrant[] | null) ?? [];
    if (grants.length === 0) {
      assessmentsWithNoGrants++;
      continue;
    }

    for (const grant of grants) {
      totalGrants++;
      confidenceCounts[grant.confidence] = (confidenceCounts[grant.confidence] ?? 0) + 1;

      const entry = grantFrequency[grant.grantId] ?? { title: grant.title, count: 0, confidences: {} };
      entry.count++;
      entry.confidences[grant.confidence] = (entry.confidences[grant.confidence] ?? 0) + 1;
      grantFrequency[grant.grantId] = entry;
    }

    // Retroactive contradiction check, using the project's *current* photo tags
    // as an approximation of the modification codes requested at assessment
    // time (tags may have changed since — noted as a caveat, not exact).
    try {
      const input = assembleEligibilityInput(assessment.project);
      const contradictions = detectCatalogContradictions(grants, input.required.modificationCodes);
      if (contradictions.length > 0) {
        contradictionsFound.push({
          projectId: assessment.projectId,
          address: assessment.project.address,
          assessmentId: assessment.id,
          grants: contradictions.map((g) => `${g.title} (confidence=${g.confidence}, source=${g.sourceUrl ?? "none"})`),
        });
      }
    } catch (error) {
      console.warn(`  Skipped contradiction check for project ${assessment.projectId}: ${String(error)}`);
    }
  }

  console.log("Provider distribution:", providerCounts);
  console.log(`Assessments with zero discovered grants: ${assessmentsWithNoGrants}`);
  console.log(`Total discovered-grant records: ${totalGrants}`);
  console.log("Confidence distribution (all discovered grants):", confidenceCounts);

  console.log("\nMost frequently discovered programs:");
  const sortedGrants = Object.entries(grantFrequency).sort((a, b) => b[1].count - a[1].count);
  for (const [grantId, info] of sortedGrants.slice(0, 15)) {
    console.log(`  ${info.title} [${grantId}] — ${info.count}x, confidence breakdown: ${JSON.stringify(info.confidences)}`);
  }

  console.log(`\n=== Retroactive catalog-contradiction check: ${contradictionsFound.length} assessment(s) flagged ===`);
  for (const c of contradictionsFound) {
    console.log(`  Project ${c.projectId} (${c.address}), assessment ${c.assessmentId}:`);
    for (const g of c.grants) {
      console.log(`    - ${g}`);
    }
  }
  if (contradictionsFound.length === 0) {
    console.log("  None found in current production data.");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
