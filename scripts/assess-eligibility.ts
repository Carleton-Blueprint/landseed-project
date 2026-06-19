/**
 * CLI helper for grant discovery testing without curl/session cookies.
 *
 * Usage:
 *   npx tsx scripts/assess-eligibility.ts <projectId>
 *
 * Env (from .env):
 *   GRANT_DISCOVERY_MOCK_AI=true|false
 *   GRANT_DISCOVERY_AI_ENABLED=true|false
 *   GRANT_DISCOVERY_AI_MODEL=gpt-4o-mini
 *   OPENAI_API_KEY=sk-...
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { assembleEligibilityInput } from '@/backend/eligibility/assembler';
import { discoverAndEvaluateGrants } from '@/backend/eligibility/discoverySearchProvider';
import { createEligibilityAssessmentSnapshot } from '@/backend/eligibility/repository';
import { prisma } from 'lib/prisma';

async function main() {
  const projectId = process.argv[2];

  if (!projectId) {
    console.error('Usage: npx tsx scripts/assess-eligibility.ts <projectId>');
    process.exit(1);
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }

  console.log(`Assessing eligibility for project ${projectId}...`);
  console.log(
    `Discovery env: AI_ENABLED=${process.env.GRANT_DISCOVERY_AI_ENABLED ?? 'true'}, ` +
      `MOCK_AI=${process.env.GRANT_DISCOVERY_MOCK_AI ?? 'false'}, ` +
      `MODEL=${process.env.GRANT_DISCOVERY_AI_MODEL ?? 'gpt-4o-mini'}`
  );

  const startedAt = Date.now();
  const input = assembleEligibilityInput(project);
  const evaluation = await discoverAndEvaluateGrants(input);
  const assessment = await createEligibilityAssessmentSnapshot({
    projectId: project.id,
    overallDecision: evaluation.overallDecision,
    programDecisions: evaluation.programDecisions,
    reasonCodes: evaluation.reasonCodes,
    missingRequirements: evaluation.missingRequirements,
    discoveredGrants: evaluation.discoveredGrants as unknown as Prisma.InputJsonValue,
    discoveryMetadata: evaluation.discoveryMetadata as unknown as Prisma.InputJsonValue,
    discoveryProvider: evaluation.discoveryMetadata.provider,
    discoveryEngineVersion: evaluation.discoveryMetadata.engineVersion,
    discoveryPromptVersion: evaluation.discoveryMetadata.promptVersion,
    discoveryScoringVersion: evaluation.discoveryMetadata.scoringVersion,
    discoveryModelVersion: evaluation.discoveryMetadata.modelVersion,
    discoverySourceSnapshotId: evaluation.discoveryMetadata.sourceSnapshotId,
  });
  const elapsedMs = Date.now() - startedAt;

  if (!assessment) {
    console.error('Assessment failed: could not persist eligibility snapshot');
    process.exit(1);
  }

  console.log(`Done in ${elapsedMs}ms`);
  console.log(JSON.stringify({
    assessmentId: assessment.id,
    overallDecision: evaluation.overallDecision,
    provider: evaluation.discoveryMetadata.provider,
    returnedCount: evaluation.discoveryMetadata.returnedCount,
    candidateCount: evaluation.discoveryMetadata.candidateCount,
    discoveredGrants: evaluation.discoveredGrants.map((g) => ({
      grantId: g.grantId,
      title: g.title,
      scope: g.scope,
      decision: g.decision,
      relevanceScore: g.relevanceScore,
      sourceUrl: g.sourceUrl,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
