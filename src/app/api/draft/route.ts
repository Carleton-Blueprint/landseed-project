/**
 * GET  /api/draft  – Load the authenticated user's most recent draft project's saved form data.
 * PATCH /api/draft  – Upsert draft form data onto the user's draft project.
 *
 * Strategy: one "draft" project per user (status="draft"). We upsert it so the user
 * can save at any time without creating duplicates. The saved JSON is validated with Zod
 * before writing so bad data is never stored.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { ProjectAccessRole } from "@prisma/client";
import { z } from "zod";

const EDITABLE_ROLES: ProjectAccessRole[] = [
  ProjectAccessRole.OWNER,
  ProjectAccessRole.EDITOR,
];

// Mirrors the partial shape of IntakeFormValues — all fields optional so a partial save is fine.
const draftSchema = z.object({
  name: z.string().max(120).optional().default(""),
  email: z.string().max(254).optional().default(""),
  phone: z.string().max(24).optional().default(""),
  addressLine1: z.string().max(200).optional().default(""),
  addressLine2: z.string().max(50).optional().default(""),
  city: z.string().max(100).optional().default(""),
  province: z.string().max(5).optional().default("ON"),
  postalCode: z.string().max(10).optional().default(""),
  ownershipStatus: z.enum(["owner", "tenant", "other"]).optional().default("owner"),
  ownershipOtherDetails: z.string().max(200).optional().default(""),
  landlordName: z.string().max(120).optional().default(""),
  landlordPhone: z.string().max(24).optional().default(""),
  isCaregiver: z.boolean().optional().default(false),
  seniorName: z.string().max(120).optional().default(""),
  relationshipToSenior: z.string().max(120).optional().default(""),
  caregiverConsentConfirmed: z.boolean().optional().default(false),
});

export type DraftData = z.infer<typeof draftSchema>;

/** GET /api/draft – returns the user's saved draft or null. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await prisma.project.findFirst({
    where: {
      status: "draft",
      projectAccess: {
        some: {
          userId: session.user.id,
          role: { in: EDITABLE_ROLES },
        },
      },
    },
    select: { id: true, draftData: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!draft || !draft.draftData) {
    return NextResponse.json({ draft: null }, { status: 200 });
  }

  return NextResponse.json({ draft: draft.draftData, draftId: draft.id, savedAt: draft.updatedAt });
}

/** PATCH /api/draft – create or update the user's draft project with partial form data. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentDraftAccess = await prisma.projectAccess.findFirst({
    where: {
      userId: session.user.id,
      project: {
        status: "draft",
      },
    },
    select: { role: true },
    orderBy: {
      project: { updatedAt: "desc" },
    },
  });

  if (currentDraftAccess && !EDITABLE_ROLES.includes(currentDraftAccess.role)) {
    return NextResponse.json({ error: "Viewers cannot edit draft" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft data", details: parsed.error.flatten() }, { status: 422 });
  }

  const draftData = parsed.data;

  // Derive an address string from what's been filled in so far.
  const addressParts = [draftData.addressLine1, draftData.city, draftData.province, draftData.postalCode]
    .filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(", ") : "Draft – address not yet set";

  // Upsert: update the most recent "draft" project, or create a new one.
  const existing = await prisma.project.findFirst({
    where: {
      status: "draft",
      projectAccess: {
        some: {
          userId: session.user.id,
          role: { in: EDITABLE_ROLES },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  let project;
  if (existing) {
    project = await prisma.project.update({
      where: { id: existing.id },
      data: { draftData, address },
    });
  } else {
    project = await prisma.project.create({
      data: {
        userId: session.user.id,
        status: "draft",
        address,
        draftData,
        projectAccess: {
          create: {
            userId: session.user.id,
            role: ProjectAccessRole.OWNER,
            grantedByUserId: session.user.id,
          },
        },
      },
    });
  }

  return NextResponse.json({ success: true, draftId: project.id, savedAt: project.updatedAt });
}
