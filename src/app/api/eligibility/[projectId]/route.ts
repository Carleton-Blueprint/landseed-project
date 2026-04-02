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

    // Return based on user type
    const response = {
      assessmentId: assessment.assessmentId,
      projectId: assessment.projectId,
      overallDecision: assessment.overallDecision,
      createdAt: assessment.createdAt,
      ...(canViewDetailedReasons && {
        // Staff can see detailed information
        detailedReasons: {
          programDecisions: assessment.programDecisions,
          reasonCodes: assessment.reasonCodes,
          missingRequirements: assessment.missingRequirements,
        },
        discovery: {
          provider: assessment.discoveryProvider,
          metadata: assessment.discoveryMetadata,
          discoveredGrants: assessment.discoveredGrants,
          version: {
            engineVersion: assessment.discoveryEngineVersion,
            promptVersion: assessment.discoveryPromptVersion,
            scoringVersion: assessment.discoveryScoringVersion,
            modelVersion: assessment.discoveryModelVersion,
            sourceSnapshotId: assessment.discoverySourceSnapshotId,
          },
        },
        grantRulesVersionNumber: assessment.grantRulesVersionNumber,
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
