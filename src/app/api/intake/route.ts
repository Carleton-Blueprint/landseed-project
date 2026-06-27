import { NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { hashPassword, validatePasswordStrength } from "@/backend/auth/password";
import { enqueueEmailVerificationIfNeeded } from "@/backend/auth/authEmailNotification";

function publicUser(user: { id: string; name: string | null; email: string | null; phone: string | null }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
  };
}

async function queueVerificationEmail(
  user: {
    id: string;
    email: string | null;
    name: string | null;
    emailVerified: Date | null;
  },
  options?: {
    seniorName?: string | null;
    isCaregiverSubmission?: boolean;
  }
) {
  if (!user.email) {
    return;
  }

  try {
    await enqueueEmailVerificationIfNeeded({
      userId: user.id,
      recipientEmail: user.email,
      recipientName: user.name,
      emailVerified: user.emailVerified,
      seniorName: options?.seniorName,
      isCaregiverSubmission: options?.isCaregiverSubmission,
    });
  } catch (error) {
    console.error("Failed to enqueue email verification:", error);
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { name, email, phone, password, seniorName, isCaregiver } = data;
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const plainPassword = typeof password === "string" ? password : "";
    const normalizedSeniorName = typeof seniorName === "string" ? seniorName.trim() : "";
    const isCaregiverSubmission = Boolean(isCaregiver);

    if (!normalizedEmail) {
      return NextResponse.json(
        { success: false, error: "Email is required." },
        { status: 400 }
      );
    }

    const strengthError = validatePasswordStrength(plainPassword);
    if (strengthError) {
      return NextResponse.json({ success: false, error: strengthError }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser?.passwordHash) {
      return NextResponse.json(
        {
          success: false,
          error: "An account with this email already exists. Please sign in instead.",
        },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(plainPassword);
    const verificationOptions = {
      seniorName: isCaregiverSubmission ? normalizedSeniorName || null : null,
      isCaregiverSubmission,
    };

    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          name: normalizedName || null,
          email: normalizedEmail,
          phone: normalizedPhone || null,
          passwordHash,
        },
      }));

    if (existingUser) {
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: normalizedName || existingUser.name,
          phone: normalizedPhone || existingUser.phone,
          passwordHash,
        },
      });

      await queueVerificationEmail(updated, verificationOptions);

      return NextResponse.json({
        success: true,
        user: publicUser(updated),
      });
    }

    await queueVerificationEmail(user, verificationOptions);

    return NextResponse.json({
      success: true,
      user: publicUser(user),
    });
  } catch (error: unknown) {
    console.error("Database error:", error);

    const prismaError = error as { code?: string; meta?: { target?: string[] } };
    if (prismaError?.code === "P2002") {
      const target = prismaError.meta?.target?.[0] ?? "field";
      return NextResponse.json(
        { success: false, error: `A user with this ${target} already exists.` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create user",
      },
      { status: 500 }
    );
  }
}
