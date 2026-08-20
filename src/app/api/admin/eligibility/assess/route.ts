/**
 * API Route: /api/admin/eligibility/assess
 * POST: Evaluate a project's eligibility and save assessment
 * Auth: NextAuth (staff/admin only)
 */

import { auth } from '@/auth';
import { hasProjectAccess } from '@/backend/auth/projectAccess';
import { getRequestAuditContext } from '@/backend/audit/requestContext';
import { logDeniedAdminAccessAttempt } from '@/backend/audit/adminAccess';
import { evaluateProjectEligibility } from '@/backend/eligibility/service';
import { estimateGenerationQueue } from '@/backend/queue';
import { buildEstimateGenerationJobId } from '@/backend/services/estimateGeneration';
import { prisma } from 'lib/prisma';

export async function POST(request: Request) {
  try {
    const session = await auth();

    // Only staff can manually trigger evaluation
    if (!session?.user?.id) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: 'route',
        actorUserId: null,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: 'AdminRoute',
        resourceId: '/api/admin/eligibility/assess',
        reason: 'unauthorized',
        description: 'Denied access to admin eligibility assessment route',
        ...auditContext,
        metadata: {
          source: 'route-handler',
          requiredRole: 'ADMIN',
        },
      });

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
      include: { photos: { select: { declaredModificationCodes: true } } },
    });

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const canAssessProject =
      project.userId === session.user.id ||
      (await hasProjectAccess(session.user.id, projectId));

    if (!canAssessProject) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: 'data',
        actorUserId: session.user.id,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: 'Project',
        resourceId: projectId,
        projectId,
        reason: 'forbidden',
        description: 'Denied project access for admin eligibility assessment',
        ...auditContext,
        metadata: {
          source: 'route-handler',
          requiredAccess: 'project:read',
        },
      });

      return Response.json({ error: 'Forbidden: You do not have access to this project' }, { status: 403 });
    }

    // This route exists to recover projects that never got a delayed
    // estimate-generation job queued (e.g. no intake finalize occurred).
    // Only proceed if no such job exists, or it completed successfully (a real
    // quote is on record, so Step 6's auto-quote no-ops). A pending job means
    // the automatic flow (queueEligibilityEvaluation, fired from
    // processScheduledEstimateGeneration) owns this project - don't race it. A
    // failed job means quote generation didn't complete cleanly and needs
    // investigation/retry - proceeding here would risk this route's own
    // evaluateProjectEligibility silently generating a quote as a side effect
    // of what looks like a routine re-assessment.
    const pendingJob = await estimateGenerationQueue.getJob(buildEstimateGenerationJobId(projectId));
    const pendingJobState = pendingJob ? await pendingJob.getState() : null;

    if (pendingJob && pendingJobState !== 'completed') {
      const error =
        pendingJobState === 'failed'
          ? 'The scheduled estimate-generation job for this project failed. Investigate and retry that job before manually re-assessing eligibility.'
          : 'Automatic eligibility evaluation is still pending for this project. Wait for the scheduled estimate generation to complete before manually re-assessing.';

      return Response.json({ error }, { status: 409 });
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