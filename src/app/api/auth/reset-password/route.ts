import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { hashPassword, validatePasswordStrength } from "@/backend/auth/password";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      token?: unknown;
      password?: unknown;
    } | null;

    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!token || !password) {
      return NextResponse.json(
        { success: false, error: "Token and password are required." },
        { status: 400 }
      );
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      return NextResponse.json({ success: false, error: strengthError }, { status: 400 });
    }

    const result = await consumeAuthEmailToken(token, AuthEmailTokenPurpose.PASSWORD_RESET);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.reason === "expired"
              ? "This reset link has expired. Please request a new one."
              : result.reason === "already_used"
                ? "This reset link has already been used. Please request a new one."
                : "This reset link is invalid.",
        },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: result.userId },
      data: { passwordHash },
    });

    return NextResponse.json({
      success: true,
      message: "Your password has been reset. You can sign in now.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { success: false, error: "Could not reset password. Please try again." },
      { status: 500 }
    );
  }
}
