/**
 * POST /api/intake-draft/promote – Validate intake, merge into shell project, finalize, delete draft.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { promoteIntakeDraft } from "@/backend/services/intakeDraft";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 }
    );
  }

  const ipAddress =
    request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent");

  const result = await promoteIntakeDraft(session.user.id, {
    actorUserId: session.user.id,
    ipAddress,
    userAgent,
  });

  if (!result.ok) {
    const status =
      result.code === "DRAFT_NOT_FOUND"
        ? 404
        : result.code === "INCOMPLETE_INTAKE"
          ? 422
          : 400;

    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
