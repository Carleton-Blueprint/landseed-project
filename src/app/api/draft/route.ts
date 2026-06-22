/**
 * GET  /api/draft  – Load the authenticated user's most recent draft project's saved form data.
 * PATCH /api/draft  – Deprecated (410). Use PATCH /api/intake-draft instead.
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
  clientConsentConfirmed: z.boolean().optional().default(false),
  modificationItems: z.array(z.string()).optional().default([]),
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

/** PATCH /api/draft – deprecated; use PATCH /api/intake-draft instead. */
export async function PATCH() {
  return NextResponse.json(
    {
      error: "Deprecated",
      message: "Draft writes have moved to /api/intake-draft. Use PATCH /api/intake-draft instead.",
      use: "/api/intake-draft",
    },
    { status: 410 }
  );
}
