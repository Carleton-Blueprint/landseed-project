import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { z } from "zod";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import * as fs from "fs";
import * as path from "path";

const MOCK_DB_FILE = "/Users/diandrainturire/Desktop/landseed-project-main/previews/profile_db.json";

const changeEmailSchema = z.object({
  newEmail: z.string().email("Invalid email format"),
});

function writeMockPendingEmail(newEmail: string) {
  try {
    const dir = path.dirname(MOCK_DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data: Record<string, unknown> = {};
    if (fs.existsSync(MOCK_DB_FILE)) {
      data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
    }
    data.pendingEmail = newEmail;
    fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write mock pending email", e);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = changeEmailSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { newEmail } = parsed.data;

    // Fetch user details from DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    // In dev mode, if user is not in DB (mocked session), we can use session details
    const currentEmail = user?.email || session.user.email || "dev@example.com";
    const currentName = user?.name || session.user.name || "Dev User";

    if (currentEmail === newEmail) {
      return NextResponse.json(
        { error: "New email must be different from current email address" },
        { status: 400 }
      );
    }

    // Check if another user already has this email
    const existingUser = await prisma.user.findUnique({
      where: { email: newEmail },
    });
    if (existingUser && existingUser.id !== session.user.id) {
      return NextResponse.json({ error: "This email address is already in use" }, { status: 400 });
    }

    // Update pending email in DB
    if (user) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { pendingEmail: newEmail },
      });
    }

    // Always update mock DB in dev mode
    if (process.env.NODE_ENV === "development") {
      writeMockPendingEmail(newEmail);
    }

    // Invalidate previous email change tokens for this user
    await prisma.authEmailToken.deleteMany({
      where: {
        userId: session.user.id,
        purpose: {
          in: [AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT, AuthEmailTokenPurpose.EMAIL_CHANGE_NEW],
        },
        usedAt: null,
      },
    });

    // Enqueue email change current token to current email address
    await enqueueAuthEmail({
      userId: session.user.id,
      recipientEmail: currentEmail,
      recipientName: currentName,
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT,
    });

    return NextResponse.json({ success: true, pendingEmail: newEmail });
  } catch (error) {
    console.error("Change email error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Update user record to clear pendingEmail
    await prisma.user.update({
      where: { id: session.user.id },
      data: { pendingEmail: null },
    });

    // In dev mode, also clear it from mock database
    if (process.env.NODE_ENV === "development") {
      writeMockPendingEmail("");
    }

    // Invalidate any active email change tokens
    await prisma.authEmailToken.deleteMany({
      where: {
        userId: session.user.id,
        purpose: {
          in: [AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT, AuthEmailTokenPurpose.EMAIL_CHANGE_NEW],
        },
        usedAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cancel change email error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
