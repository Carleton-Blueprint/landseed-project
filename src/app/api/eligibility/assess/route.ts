/**
 * API Route: /api/eligibility/assess
 * POST: Evaluate a project's eligibility and save assessment
 * Auth: NextAuth (staff/admin only)
 */

import { auth } from '@/auth';
import { hasProjectAccess } from '@/backend/auth/projectAccess';
import { evaluateProjectEligibility } from '@/backend/eligibility/service';
import { prisma } from 'lib/prisma';

export async function POST(request: Request) {
  try {
    const session = await auth();

    // Only staff can manually trigger evaluation
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return Response.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Get project and user
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const canAssessProject =
      project.userId === session.user.id ||
      (await hasProjectAccess(session.user.id, projectId));

    if (!canAssessProject) {
      return Response.json({ error: 'Forbidden: You do not have access to this project' }, { status: 403 });
    }

    // Evaluate eligibility
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    const result = await evaluateProjectEligibility(project, user ?? undefined);

    if ('code' in result && result.code) {
      // Error result
      return Response.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error('Eligibility assessment POST error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
