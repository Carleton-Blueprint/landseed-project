import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import { buildRateLimitKey, checkRateLimit, enforceRateLimit } from "@/backend/auth/rateLimit";
import { GENERIC_AUTH_EMAIL_RESPONSE, getClientIp } from "@/backend/auth/authEmailResponses";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";

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

    // Email-scoped check stays manual: denial must stay on the generic
    // response, not a 429 (see comment below), which enforceRateLimit
    // can't express — it always maps a denial to a 429.
    const emailLimit = await checkRateLimit(
      buildRateLimitKey("forgot-password-email", email),
      FORGOT_PASSWORD_LIMIT,
      FORGOT_PASSWORD_WINDOW_SECONDS
    );

    // IP-scoped check: a real 429 here is fine (see comment below), so this
    // is exactly enforceRateLimit's standard check+log+429 behavior.
    const { response: ipLimitResponse } = await enforceRateLimit({
      scope: "forgot-password-ip",
      identifier: clientIp,
      limit: FORGOT_PASSWORD_LIMIT,
      windowSeconds: FORGOT_PASSWORD_WINDOW_SECONDS,
      route: "/api/auth/forgot-password",
      message: "Too many requests. Please try again later.",
    });

    if (!emailLimit.allowed) {
      // Per-email hits stay on the generic response, not a 429: returning a
      // different status/header for "this address gets a lot of reset
      // requests" would itself be a signal about that specific address,
      // which is exactly what GENERIC_AUTH_EMAIL_RESPONSE exists to avoid.
      await logSecurityEventNonBlocking({
        eventType: "RATE_LIMIT_HIT",
        scope: "forgot-password-email",
        identifier: email,
        route: "/api/auth/forgot-password",
        metadata: { limit: FORGOT_PASSWORD_LIMIT, windowSeconds: FORGOT_PASSWORD_WINDOW_SECONDS },
      });
      return NextResponse.json(GENERIC_AUTH_EMAIL_RESPONSE);
    }

    if (ipLimitResponse) {
      // The IP-based limit is frequency-of-requests-from-this-IP, not tied
      // to any one account, so a real 429 here doesn't leak account
      // existence the way an email-scoped 429 would.
      return ipLimitResponse;
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
