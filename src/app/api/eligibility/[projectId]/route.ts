/**
 * API Route: /api/eligibility/[projectId]
 * GET: Retrieve eligibility assessment for a project
 * - Staff sees full reason codes and messages
 * - Clients see only simplified messages
 * Auth: NextAuth (project must belong to user or user must be staff)
 */

import { ProjectAccessRole } from '@prisma/client';
import { auth } from '@/auth';
import { getLatestEligibilityAssessment } from '@/backend/eligibility/service';
import { hasProjectAccess } from '@/backend/auth/projectAccess';
import { prisma } from 'lib/prisma';
import { applyGrantOverridesToRawGrants } from '@/backend/services/quoteOverride';
import type { GrantOverrides } from '@/backend/services/quoteOverride';
import type { DiscoveredGrant } from '@/backend/eligibility/discoverySearchProvider';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;

    // ── DEV MODE BYPASS: return mock eligibility data when DB is not available ──
    // Set GRANT_DISCOVERY_DEV_MOCK_GET=false to read real assessments from the DB.
    const useDevMockGet =
      process.env.NODE_ENV === 'development' &&
      (process.env.GRANT_DISCOVERY_DEV_MOCK_GET ?? 'true').toLowerCase() !== 'false';

    if (useDevMockGet) {
      const response = {
        assessmentId: "dev-assessment-1",
        projectId,
        overallDecision: "ELIGIBLE",
        createdAt: new Date().toISOString(),
        detailedReasons: {
          programDecisions: ["ELIGIBLE"],
          reasonCodes: ["MATCHED"],
          missingRequirements: [],
        },
        discovery: {
          provider: "OPENAI",
          metadata: {
            candidateCount: 15,
            returnedCount: 2,
          },
          discoveredGrants: [
            {
              grantId: "grant-1",
              title: "Home Modification for Seniors Independence (HMSI)",
              scope: "PROVINCIAL",
              jurisdiction: "Ontario",
              sourceUrl: "https://www.ontario.ca",
              summary: "Funding for low-income seniors to make safety modifications to their home.",
              decision: "ELIGIBLE",
              relevanceScore: 94,
              confidence: "HIGH",
              matchedCriteria: ["Age >= 65", "Income <= $35,000", "Homeowner"],
              missingCriteria: [],
              rationale: "Client meets all eligibility criteria for the Ontario HMSI program. Ramps and grab bars are fully covered modification items.",
            },
            {
              grantId: "grant-2",
              title: "March of Dimes Home & Vehicle Modification Program",
              scope: "MUNICIPAL",
              jurisdiction: "Toronto",
              sourceUrl: "https://www.marchofdimes.ca",
              summary: "Provides financial assistance for basic home modifications to improve safety and accessibility.",
              decision: "NEEDS_MORE_INFO",
              relevanceScore: 82,
              confidence: "MEDIUM",
              matchedCriteria: ["Permanent physical disability", "Ontario resident"],
              missingCriteria: ["Proof of household income", "Written quote from contractor"],
              rationale: "Client is likely eligible but requires contractor quote and proof of income for final verification.",
            }
          ],
          version: {
            engineVersion: "1.2.0",
            promptVersion: "2.0",
            scoringVersion: "1.0",
            modelVersion: "gpt-4o",
            sourceSnapshotId: "Ontario-Intake-2026",
          },
        },
      };
      return Response.json(response, { status: 200 });
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Get project to verify access
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { user: true },
    });

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check if user owns project or is staff
    const isOwner = project.userId === session.user.id;
    const hasAccess = await hasProjectAccess(session.user.id, projectId);
    const canViewDetailedReasons = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.EDITOR
    );

    if (!isOwner && !hasAccess) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get latest assessment
    const assessment = await getLatestEligibilityAssessment(projectId);

    if (!assessment) {
      return Response.json(
        { error: 'No eligibility assessment found' },
        { status: 404 }
      );
    }

    // A post-estimate override (FR-4.3) may have adjusted the overall
    // decision and/or the discovered-grants list since this assessment ran;
    // merge it in so clients and staff see the same "effective" eligibility
    // the admin dashboard shows, not the untouched AI output.
    const latestQuote = await prisma.quote.findFirst({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
      include: { override: true },
    });
    const override = latestQuote?.override ?? null;
    const effectiveOverallDecision = override?.eligibilityDecision ?? assessment.overallDecision;
    const effectiveDiscoveredGrants = override
      ? applyGrantOverridesToRawGrants(
          Array.isArray(assessment.discoveredGrants) ? (assessment.discoveredGrants as unknown as DiscoveredGrant[]) : [],
          override.grantOverrides as unknown as GrantOverrides
        )
      : assessment.discoveredGrants;

    // Return based on user type
    const response = {
      assessmentId: assessment.assessmentId,
      projectId: assessment.projectId,
      overallDecision: effectiveOverallDecision,
      createdAt: assessment.createdAt,
      discovery: {
        provider: assessment.discoveryProvider,
        metadata: assessment.discoveryMetadata,
        discoveredGrants: effectiveDiscoveredGrants,
        version: {
          engineVersion: assessment.discoveryEngineVersion,
          promptVersion: assessment.discoveryPromptVersion,
          scoringVersion: assessment.discoveryScoringVersion,
          modelVersion: assessment.discoveryModelVersion,
          sourceSnapshotId: assessment.discoverySourceSnapshotId,
        },
      },
      ...(canViewDetailedReasons && {
        // Staff can see detailed information
        detailedReasons: {
          programDecisions: assessment.programDecisions,
          reasonCodes: assessment.reasonCodes,
          missingRequirements: assessment.missingRequirements,
        },
      }),
      ...(!canViewDetailedReasons && {
        // Clients see only the decision and simplified message
        // (message should be computed from the decision in the frontend)
      }),
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Eligibility assessment GET error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
