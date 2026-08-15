import { NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { z } from "zod";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { hashAuthEmailToken, consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import * as fs from "fs";
import * as path from "path";

const MOCK_DB_FILE = "/Users/diandrainturire/Desktop/landseed-project-main/previews/profile_db.json";

const verifySchema = z.object({
  token: z.string().min(1, "Token is required"),
  step: z.enum(["current", "new"]),
});

function readMockProfile() {
  if (fs.existsSync(MOCK_DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
    } catch {
      // ignore
    }
  }
  return {};
}

function writeMockProfileEmail(email: string) {
  try {
    const dir = path.dirname(MOCK_DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data: Record<string, unknown> = {};
    if (fs.existsSync(MOCK_DB_FILE)) {
      data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
    }
    data.email = email;
    data.pendingEmail = null;
    fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write mock profile email", e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { token, step } = parsed.data;
    const tokenHash = hashAuthEmailToken(token);

    // Find the token record
    const tokenRecord = await prisma.authEmailToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    // Verify token expiration and status
    if (tokenRecord.usedAt) {
      return NextResponse.json({ error: "already_used" }, { status: 400 });
    }

    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "expired" }, { status: 400 });
    }

    // Validate that purpose matches step
    const expectedPurpose =
      step === "current"
        ? AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT
        : AuthEmailTokenPurpose.EMAIL_CHANGE_NEW;

    if (tokenRecord.purpose !== expectedPurpose) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    // Consume the token using standard utility
    const consumeResult = await consumeAuthEmailToken(token, expectedPurpose);
    if (!consumeResult.ok) {
      return NextResponse.json({ error: consumeResult.reason }, { status: 400 });
    }

    // Get pending email
    let pendingEmail = tokenRecord.user.pendingEmail;
    if (process.env.NODE_ENV === "development" && !pendingEmail) {
      const mockData = readMockProfile();
      pendingEmail = mockData.pendingEmail;
    }

    if (!pendingEmail) {
      return NextResponse.json({ error: "no_pending_email" }, { status: 400 });
    }

    if (step === "current") {
      // Step 1 completed successfully: send second token to new/pending email address
      await enqueueAuthEmail({
        userId: tokenRecord.userId,
        recipientEmail: pendingEmail,
        recipientName: tokenRecord.user.name,
        purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW,
      });

      return NextResponse.json({ success: true, step: "current", pendingEmail });
    } else {
      // Step 2 completed successfully: finalize email address update in DB
      await prisma.user.update({
        where: { id: tokenRecord.userId },
        data: {
          email: pendingEmail,
          pendingEmail: null,
        },
      });

      // Update mock file for dev persistence
      if (process.env.NODE_ENV === "development") {
        writeMockProfileEmail(pendingEmail);
      }

      return NextResponse.json({ success: true, step: "new", email: pendingEmail });
    }
  } catch (error) {
    console.error("Verify email change error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
