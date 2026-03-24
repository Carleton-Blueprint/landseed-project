/**
 * API Route: /api/eligibility/[projectId]
 * GET: Retrieve eligibility assessment for a project
 * - Staff sees full reason codes and messages
 * - Clients see only simplified messages
 * Auth: NextAuth (project must belong to user or user must be staff)
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/auth';
import { getLatestEligibilityAssessment } from '@/src/backend/eligibility/service';
import prisma from 'lib/prisma';

async function isStaffUser(userId: string): Promise<boolean> {
  // Simple check: staff users would have elevated roles or special flags
  // For now, check if user has created any grant rules (staff marker)
  const grantRulesCount = await prisma.grantRulesVersion.count({
    where: { createdByUserId: userId },
  });
  return grantRulesCount > 0;
}

export async function GET(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = params;

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
    const isStaff = await isStaffUser(session.user.id!);

    if (!isOwner && !isStaff) {
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
      ...(isStaff && {
        // Staff can see detailed information
        detailedReasons: {
          programDecisions: assessment.programDecisions,
          reasonCodes: assessment.reasonCodes,
          missingRequirements: assessment.missingRequirements,
        },
        grantRulesVersionNumber: assessment.grantRulesVersionNumber,
      }),
      ...(!isStaff && {
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
