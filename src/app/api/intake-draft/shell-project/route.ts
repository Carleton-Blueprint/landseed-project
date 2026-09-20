/**
 * POST /api/intake-draft/shell-project – Ensure a shell draft project exists for photo uploads.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureShellProject } from "@/backend/services/intakeDraft";
import { enforceDualRateLimit } from "@/backend/auth/rateLimit";
import { getClientIp } from "@/backend/auth/authEmailResponses";

const SHELL_PROJECT_LIMIT = 10;
const SHELL_PROJECT_IP_LIMIT = 50;
const SHELL_PROJECT_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const session = await auth();

  const { response: rateLimitResponse } = await enforceDualRateLimit({
    scope: "intake-draft-shell-project",
    accountId: session?.user?.id ?? null,
    ip: getClientIp(request),
    accountLimit: SHELL_PROJECT_LIMIT,
    accountWindowSeconds: SHELL_PROJECT_WINDOW_SECONDS,
    ipLimit: SHELL_PROJECT_IP_LIMIT,
    ipWindowSeconds: SHELL_PROJECT_WINDOW_SECONDS,
    route: "/api/intake-draft/shell-project",
    accountMessage: "Too many submissions on this account. Please try again later.",
    ipMessage: "Too many submissions from this network. Please try again later.",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

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
