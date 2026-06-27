import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";

function redirectToSignIn(request: NextRequest, status: "success" | "invalid" | "expired" | "used") {
  const url = new URL("/auth/signin", request.url);
  url.searchParams.set("verified", status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    if (request.headers.get("accept")?.includes("text/html")) {
      return redirectToSignIn(request, "invalid");
    }
    return NextResponse.json({ success: false, error: "Token is required." }, { status: 400 });
  }

  const result = await consumeAuthEmailToken(token, AuthEmailTokenPurpose.EMAIL_VERIFICATION);

  if (!result.ok) {
    const status = result.reason === "expired" ? "expired" : result.reason === "already_used" ? "used" : "invalid";
    if (request.headers.get("accept")?.includes("text/html")) {
      return redirectToSignIn(request, status);
    }
    return NextResponse.json(
      {
        success: false,
        error:
          result.reason === "expired"
            ? "This verification link has expired."
            : result.reason === "already_used"
              ? "This verification link has already been used."
              : "This verification link is invalid.",
      },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: result.userId },
    data: { emailVerified: new Date() },
  });

  if (request.headers.get("accept")?.includes("text/html")) {
    return redirectToSignIn(request, "success");
  }

  return NextResponse.json({ success: true, message: "Email verified successfully." });
}
