/**
 * API Route: /api/admin/projects/[projectId]/buildertrend-transfer/manual-sync
 * POST: Record that staff manually confirmed the project's BuilderTrend work
 * order status out-of-band (fallback for when BuilderTrend doesn't push
 * status callbacks). Auth: NextAuth (admin/advisory only)
 */

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError, requireMinimumRole } from "@/backend/auth/requireRole";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { prisma } from "lib/prisma";
import {
  BuilderTrendStatusCallbackError,
  recordBuilderTrendManualSync,
} from "@/backend/integrations/buildertrend";

async function requireAdminForManualSync(
  request: Request,
  session: Session | null,
  projectId: string
): Promise<Response | null> {
  try {
    await requireMinimumRole(session, "ADMIN");
    return null;
  } catch (error) {
    if (error instanceof HttpError) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: "route",
        actorUserId: session?.user?.id ?? null,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: "BuilderTrendTransferManualSync",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to BuilderTrend manual sync route",
        ...auditContext,
        metadata: {
          source: "route-handler",
          requiredRole: "ADMIN",
        },
      });

      return authGateResponse(error) ?? Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: "forbidden" }, { status: 403 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForManualSync(request, session, projectId);
    if (denied) return denied;

    const transfer = await prisma.builderTrendTransfer.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!transfer) {
      return Response.json({ error: "No BuilderTrend transfer exists for this project" }, { status: 404 });
    }

    const result = await recordBuilderTrendManualSync({
      transferId: transfer.id,
      actorUserId: session!.user!.id,
    });

    return Response.json(
      { transferId: result.transferId, lastManualSyncAt: result.lastManualSyncAt.toISOString() },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof BuilderTrendStatusCallbackError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("BuilderTrend manual sync error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
