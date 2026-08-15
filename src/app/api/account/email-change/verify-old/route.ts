import { NextRequest, NextResponse } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { enqueueEmailChangeVerification } from "@/backend/auth/authEmailNotification";
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

  const result = await consumeAuthEmailToken(token, AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM);

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

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { name: true },
  });

  const emailTaken = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });

  if (emailTaken) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "EMAIL_CHANGE_OLD_EMAIL_VERIFIED",
      outcome: "FAILURE",
      sensitivityLevel: "CONFIDENTIAL",
      actorUserId: result.userId,
      resourceType: "User",
      resourceId: result.userId,
      description: "Current-email verification succeeded, but the requested new email is now taken by another account.",
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

  await enqueueEmailChangeVerification({
    userId: result.userId,
    purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
    newEmail,
    recipientEmail: newEmail,
    recipientName: user?.name,
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "EMAIL_CHANGE_OLD_EMAIL_VERIFIED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: result.userId,
    resourceType: "User",
    resourceId: result.userId,
    description: "Current email verified for email change; verification link sent to the new email address.",
    metadata: { requestedNewEmail: newEmail },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  if (wantsHtml(request)) return redirectToProfile(request, "old_verified");
  return NextResponse.json({
    success: true,
    message: "Current email verified. A confirmation link has been sent to your new email address.",
  });
}
