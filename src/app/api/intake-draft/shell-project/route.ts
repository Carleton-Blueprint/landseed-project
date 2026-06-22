/**
 * POST /api/intake-draft/shell-project – Ensure a shell draft project exists for photo uploads.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureShellProject } from "@/backend/services/intakeDraft";

export async function POST() {
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
