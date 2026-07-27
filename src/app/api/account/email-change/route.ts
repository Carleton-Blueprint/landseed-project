import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { enqueueEmailChangeVerification } from "@/backend/auth/authEmailNotification";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { buildRateLimitKey, checkRateLimit } from "@/backend/auth/rateLimit";
import { getClientIp } from "@/backend/auth/authEmailResponses";

const EMAIL_CHANGE_REQUEST_LIMIT = 3;
const EMAIL_CHANGE_REQUEST_WINDOW_SECONDS = 60 * 60;

const bodySchema = z.object({
  newEmail: z.string().email(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let newEmail: string;
  try {
    const body = await request.json();
    ({ newEmail } = bodySchema.parse(body));
  } catch {
    return NextResponse.json({ error: "A valid newEmail is required." }, { status: 400 });
  }

  const normalizedNewEmail = newEmail.trim().toLowerCase();

  const rateLimit = await checkRateLimit(
    buildRateLimitKey("email-change-request", session.user.id),
    EMAIL_CHANGE_REQUEST_LIMIT,
    EMAIL_CHANGE_REQUEST_WINDOW_SECONDS
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many email change requests. Please try again later." },
      { status: 429 }
    );
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true },
  });

  if (!currentUser?.email) {
    return NextResponse.json({ error: "No email is on file for this account." }, { status: 400 });
  }

  if (normalizedNewEmail === currentUser.email.toLowerCase()) {
    return NextResponse.json(
      { error: "New email must be different from your current email." },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedNewEmail },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ error: "That email address is already in use." }, { status: 409 });
  }

  await enqueueEmailChangeVerification({
    userId: session.user.id,
    purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
    newEmail: normalizedNewEmail,
    recipientEmail: currentUser.email,
    recipientName: currentUser.name,
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "EMAIL_CHANGE_REQUESTED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: session.user.id,
    resourceType: "User",
    resourceId: session.user.id,
    description: "Email change requested; verification link sent to the current email address.",
    metadata: { requestedNewEmail: normalizedNewEmail },
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    success: true,
    message: "A verification link has been sent to your current email address.",
  });
}
