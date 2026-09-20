/**
 * POST /api/intake-draft/promote – Validate intake, merge into shell project, finalize, delete draft.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { promoteIntakeDraft } from "@/backend/services/intakeDraft";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { requireVerifiedEmail } from "@/backend/auth/requireVerifiedEmail";
import { enforceDualRateLimit } from "@/backend/auth/rateLimit";
import { getClientIp } from "@/backend/auth/authEmailResponses";

const PROMOTE_SUBMISSION_LIMIT = 10;
const PROMOTE_SUBMISSION_IP_LIMIT = 50;
const PROMOTE_SUBMISSION_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const session = await auth();

  const { response: rateLimitResponse } = await enforceDualRateLimit({
    scope: "intake-draft-promote",
    accountId: session?.user?.id ?? null,
    ip: getClientIp(request),
    accountLimit: PROMOTE_SUBMISSION_LIMIT,
    accountWindowSeconds: PROMOTE_SUBMISSION_WINDOW_SECONDS,
    ipLimit: PROMOTE_SUBMISSION_IP_LIMIT,
    ipWindowSeconds: PROMOTE_SUBMISSION_WINDOW_SECONDS,
    route: "/api/intake-draft/promote",
    accountMessage: "Too many submissions on this account. Please try again later.",
    ipMessage: "Too many submissions from this network. Please try again later.",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    await requireVerifiedEmail(session);
  } catch (error) {
    const gateResponse = authGateResponse(error);
    if (gateResponse) {
      const body = await gateResponse.json();
      return NextResponse.json(
        {
          ok: false,
          code: body.code ?? "EMAIL_VERIFICATION_REQUIRED",
          message: body.error ?? "Please verify your email before continuing.",
        },
        { status: gateResponse.status }
      );
    }
    throw error;
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
        : result.code === "INCOMPLETE_INTAKE" ||
            result.code === "NO_PHOTOS_UPLOADED" ||
            result.code === "PHOTOS_MISSING_TAGS"
          ? 422
          : 400;

    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
