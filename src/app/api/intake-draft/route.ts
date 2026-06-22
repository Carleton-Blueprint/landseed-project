/**
 * GET   /api/intake-draft – Load the authenticated user's intake draft.
 * POST  /api/intake-draft – Idempotent get-or-create for the user's intake draft.
 * PATCH /api/intake-draft – Replace one or both section snapshots (guidedData, intakeData).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getIntakeDraft,
  getOrCreateIntakeDraft,
  mergeIntakeDraft,
} from "@/backend/services/intakeDraft";
import { patchIntakeDraftSchema } from "@/backend/schemas/intakeDraft";

function serializeDraft(draft: {
  id: string;
  guidedData: unknown;
  intakeData: unknown;
  updatedAt: Date;
}) {
  return {
    draftId: draft.id,
    guidedData: draft.guidedData,
    intakeData: draft.intakeData,
    savedAt: draft.updatedAt,
  };
}

/** GET /api/intake-draft – returns the user's saved draft or null. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await getIntakeDraft(session.user.id);

  if (!draft) {
    return NextResponse.json({ draft: null }, { status: 200 });
  }

  return NextResponse.json(serializeDraft(draft), { status: 200 });
}

/** POST /api/intake-draft – idempotent get-or-create. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const draft = await getOrCreateIntakeDraft(session.user.id);

  return NextResponse.json(serializeDraft(draft), { status: 200 });
}

/** PATCH /api/intake-draft – replace section snapshot(s). */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchIntakeDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid draft data", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const draft = await mergeIntakeDraft(session.user.id, parsed.data);

  return NextResponse.json(serializeDraft(draft), { status: 200 });
}
