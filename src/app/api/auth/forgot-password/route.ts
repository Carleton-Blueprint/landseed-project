import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import { buildRateLimitKey, checkRateLimit } from "@/backend/auth/rateLimit";
import { GENERIC_AUTH_EMAIL_RESPONSE, getClientIp } from "@/backend/auth/authEmailResponses";

const FORGOT_PASSWORD_LIMIT = 3;
const FORGOT_PASSWORD_WINDOW_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ success: false, error: "Email is required." }, { status: 400 });
    }

    const clientIp = getClientIp(request);
    const emailLimit = await checkRateLimit(
      buildRateLimitKey("forgot-password-email", email),
      FORGOT_PASSWORD_LIMIT,
      FORGOT_PASSWORD_WINDOW_SECONDS
    );
    const ipLimit = await checkRateLimit(
      buildRateLimitKey("forgot-password-ip", clientIp),
      FORGOT_PASSWORD_LIMIT,
      FORGOT_PASSWORD_WINDOW_SECONDS
    );

    if (!emailLimit.allowed || !ipLimit.allowed) {
      return NextResponse.json(GENERIC_AUTH_EMAIL_RESPONSE);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    if (user?.email && user.passwordHash) {
      try {
        await enqueueAuthEmail({
          userId: user.id,
          recipientEmail: user.email,
          recipientName: user.name,
          purpose: AuthEmailTokenPurpose.PASSWORD_RESET,
        });
      } catch (error) {
        console.error("Failed to enqueue password reset email:", error);
      }
    }

    return NextResponse.json(GENERIC_AUTH_EMAIL_RESPONSE);
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(GENERIC_AUTH_EMAIL_RESPONSE);
  }
}
