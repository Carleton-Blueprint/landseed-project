import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const MOCK_DB_FILE = path.join(process.cwd(), "previews", "consultations_db.json");

interface MockConsultation {
  id: string;
  projectId: string;
  scheduledAt: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function readMockConsultation(projectId: string): MockConsultation | null {
  if (fs.existsSync(MOCK_DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
      return data[projectId] || null;
    } catch {
      // ignore
    }
  }
  return null;
}

function writeMockConsultation(projectId: string, payload: { scheduledAt: string; notes?: string | null; status?: string }) {
  const dir = path.dirname(MOCK_DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let data: Record<string, MockConsultation> = {};
  if (fs.existsSync(MOCK_DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(MOCK_DB_FILE, "utf-8"));
    } catch {
      // ignore
    }
  }

  const existing = data[projectId];
  const nowStr = new Date().toISOString();

  data[projectId] = {
    id: existing?.id || `mock-consultation-${Math.random().toString(36).substr(2, 9)}`,
    projectId,
    scheduledAt: payload.scheduledAt,
    status: payload.status || existing?.status || "PENDING",
    notes: payload.notes !== undefined ? payload.notes : (existing?.notes ?? null),
    createdAt: existing?.createdAt || nowStr,
    updatedAt: nowStr,
  };

  fs.writeFileSync(MOCK_DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  return data[projectId];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    const hasAccess = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.VIEWER
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const consultation = await prisma.consultationRequest.findUnique({
      where: { projectId },
    });

    if (!consultation && isDev) {
      const mock = readMockConsultation(projectId);
      return NextResponse.json({ consultation: mock });
    }

    return NextResponse.json({ consultation });
  } catch (error) {
    if (isDev) {
      const mock = readMockConsultation(projectId);
      return NextResponse.json({ consultation: mock });
    }
    console.error("[Consultation GET API Error]:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    const hasAccess = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.EDITOR
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const body = await request.json();
    const { scheduledAt, notes, status } = body;

    if (!scheduledAt) {
      return NextResponse.json({ error: "scheduledAt is required" }, { status: 400 });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (isDev) {
      const mock = writeMockConsultation(projectId, { scheduledAt, notes, status });
      return NextResponse.json({ success: true, consultation: mock });
    }

    const consultation = await prisma.consultationRequest.upsert({
      where: { projectId },
      update: {
        scheduledAt: scheduledDate,
        notes,
        status: status || "PENDING",
      },
      create: {
        projectId,
        scheduledAt: scheduledDate,
        notes,
        status: "PENDING",
      },
    });

    return NextResponse.json({ success: true, consultation });
  } catch (error) {
    if (isDev) {
      try {
        const body = await request.json();
        const { scheduledAt, notes, status } = body;
        const mock = writeMockConsultation(projectId, { scheduledAt, notes, status });
        return NextResponse.json({ success: true, consultation: mock });
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    console.error("[Consultation POST API Error]:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
