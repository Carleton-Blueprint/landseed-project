import { NextResponse } from "next/server";
import { HttpError } from "@/backend/auth/requireRole";
import { EmailVerificationRequiredError } from "@/backend/auth/requireVerifiedEmail";

export function authGateResponse(error: unknown): NextResponse | null {
  if (error instanceof EmailVerificationRequiredError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status }
    );
  }

  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return null;
}
