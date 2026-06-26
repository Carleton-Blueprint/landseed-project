import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { enqueueEmailVerificationIfNeeded } from "@/backend/auth/authEmailNotification";
import { buildRateLimitKey, checkRateLimit } from "@/backend/auth/rateLimit";

const RESEND_VERIFICATION_LIMIT = 3;
const RESEND_VERIFICATION_WINDOW_SECONDS = 5 * 60;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
      },
    });

    if (!user?.email) {
      return NextResponse.json(
        { success: false, error: "No email address is associated with this account." },
        { status: 400 }
      );
    }

    if (user.emailVerified) {
      return NextResponse.json({
        success: true,
        message: "Your email is already verified.",
      });
    }

    const rateLimit = await checkRateLimit(
      buildRateLimitKey("resend-verification", user.id),
      RESEND_VERIFICATION_LIMIT,
      RESEND_VERIFICATION_WINDOW_SECONDS
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Please wait before requesting another verification email.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    await enqueueEmailVerificationIfNeeded({
      userId: user.id,
      recipientEmail: user.email,
      recipientName: user.name,
      emailVerified: user.emailVerified,
    });

    return NextResponse.json({
      success: true,
      message: "Verification email sent.",
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json(
      { success: false, error: "Could not send verification email. Please try again." },
      { status: 500 }
    );
  }
}
