import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const MOCK_DB_FILE = "/Users/diandrainturire/Desktop/landseed-project-main/previews/profile_db.json";

const profileSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
});

function readMockProfile(defaultUser: { id: string; name: string; email: string }) {
  if (fs.existsSync(MOCK_DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
      return {
        name: data.name || defaultUser.name,
        email: data.email || defaultUser.email,
        phone: data.phone ?? "(555) 019-2834",
      };
    } catch {
      // ignore
    }
  }
  return {
    name: defaultUser.name,
    email: defaultUser.email,
    phone: "(555) 019-2834",
  };
}

function writeMockProfile(data: { name: string; email: string; phone?: string | null | undefined }) {
  const dir = path.dirname(MOCK_DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // File-based development persistence fallback
  if (process.env.NODE_ENV === "development") {
    const user = readMockProfile({
      id: session.user.id,
      name: session.user.name || "Dev User",
      email: session.user.email || "dev@example.com",
    });
    return NextResponse.json(user);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, phone: true },
    });
    return NextResponse.json(user);
  } catch (error) {
    console.error("Profile load error (using fallback):", error);
    return NextResponse.json({
      name: session.user.name || "Dev User",
      email: session.user.email || "dev@example.com",
      phone: "",
    });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = profileSchema.parse(body);

    // File-based development persistence fallback
    if (process.env.NODE_ENV === "development") {
      const currentMockProfile = readMockProfile({
        id: session.user.id,
        name: session.user.name || "Dev User",
        email: session.user.email || "dev@example.com",
      });

      if (data.email !== currentMockProfile.email) {
        return NextResponse.json(
          {
            error: "Email changes require verification. Use the email change endpoint instead.",
            code: "EMAIL_CHANGE_REQUIRES_VERIFICATION",
          },
          { status: 409 }
        );
      }

      writeMockProfile(data);
      return NextResponse.json({ success: true, user: data });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true },
    });

    if (data.email !== currentUser?.email) {
      return NextResponse.json(
        {
          error: "Email changes require verification. Use the email change endpoint instead.",
          code: "EMAIL_CHANGE_REQUIRES_VERIFICATION",
        },
        { status: 409 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: data.name,
        phone: data.phone,
      },
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
}
