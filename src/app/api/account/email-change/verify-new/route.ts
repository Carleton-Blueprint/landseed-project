import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

function wantsHtml(request: NextRequest): boolean {
  return Boolean(request.headers.get("accept")?.includes("text/html"));
}

function redirectToProfile(request: NextRequest, status: string) {
  const url = new URL("/profile", request.url);
  url.searchParams.set("emailChange", status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    if (wantsHtml(request)) return redirectToProfile(request, "invalid");
    return NextResponse.json({ success: false, error: "Token is required." }, { status: 400 });
  }

  const result = await consumeAuthEmailToken(token, AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM);

  if (!result.ok) {
    const status = result.reason === "expired" ? "expired" : result.reason === "already_used" ? "used" : "invalid";
    if (wantsHtml(request)) return redirectToProfile(request, status);
    return NextResponse.json(
      {
        success: false,
        error:
          result.reason === "expired"
            ? "This verification link has expired. Please restart the email change request."
            : result.reason === "already_used"
              ? "This verification link has already been used."
              : "This verification link is invalid.",
      },
      { status: 400 }
    );
  }

  const newEmail = result.newEmail;
  if (!newEmail) {
    if (wantsHtml(request)) return redirectToProfile(request, "invalid");
    return NextResponse.json({ success: false, error: "This verification link is invalid." }, { status: 400 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { email: true },
  });

  try {
    await prisma.user.update({
      where: { id: result.userId },
      data: { email: newEmail, emailVerified: new Date() },
    });
  } catch (error: unknown) {
    const prismaError = error as { code?: string };
    if (prismaError?.code === "P2002") {
      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "EMAIL_CHANGE_COMPLETED",
        outcome: "FAILURE",
        sensitivityLevel: "CONFIDENTIAL",
        actorUserId: result.userId,
        resourceType: "User",
        resourceId: result.userId,
        description: "New-email verification succeeded, but the address was claimed by another account before the change could be applied.",
        metadata: { requestedNewEmail: newEmail },
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      });

      if (wantsHtml(request)) return redirectToProfile(request, "new_email_taken");
      return NextResponse.json(
        { success: false, error: "That email address is no longer available." },
        { status: 409 }
      );
    }

    throw error;
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "EMAIL_CHANGE_COMPLETED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: result.userId,
    resourceType: "User",
    resourceId: result.userId,
    description: "Email address updated after both current and new email were verified.",
    beforeState: { email: currentUser?.email ?? null },
    afterState: { email: newEmail },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  if (wantsHtml(request)) return redirectToProfile(request, "completed");
  return NextResponse.json({
    success: true,
    message: "Your email address has been updated.",
  });
}
