/**
 * POST /api/intake-draft/shell-project – Ensure a shell draft project exists for photo uploads.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureShellProject } from "@/backend/services/intakeDraft";
import { enforceRateLimit } from "@/backend/auth/rateLimit";
import { getClientIp } from "@/backend/auth/authEmailResponses";

const SHELL_PROJECT_LIMIT = 10;
const SHELL_PROJECT_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const { response: rateLimitResponse } = await enforceRateLimit({
    scope: "intake-draft-shell-project-ip",
    identifier: getClientIp(request),
    limit: SHELL_PROJECT_LIMIT,
    windowSeconds: SHELL_PROJECT_WINDOW_SECONDS,
    route: "/api/intake-draft/shell-project",
    message: "Too many submissions from this network. Please try again later.",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draft, project } = await ensureShellProject(session.user.id);

  return NextResponse.json(
    {
      draftId: draft.id,
      projectId: project.id,
    },
    { status: 200 }
  );
}
