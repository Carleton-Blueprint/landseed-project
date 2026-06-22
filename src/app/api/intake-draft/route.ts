/**
 * GET   /api/intake-draft – Load the authenticated user's intake draft.
 * POST  /api/intake-draft – Idempotent get-or-create for the user's intake draft.
 * PATCH /api/intake-draft – Replace one or both section snapshots (guidedData, intakeData).
 * DELETE /api/intake-draft – Discard draft and linked shell project when still draft.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getOrCreateIntakeDraft,
  loadIntakeDraftWithPhotos,
  mergeIntakeDraft,
  deleteIntakeDraft,
} from "@/backend/services/intakeDraft";
import { patchIntakeDraftSchema } from "@/backend/schemas/intakeDraft";
import type { IntakeDraftPhoto } from "@/backend/services/intakeDraft";

function serializeDraft(
  draft: {
    id: string;
    guidedData: unknown;
    intakeData: unknown;
    projectId: string | null;
    updatedAt: Date;
  },
  photos: IntakeDraftPhoto[] = []
) {
  return {
    draftId: draft.id,
    guidedData: draft.guidedData,
    intakeData: draft.intakeData,
    projectId: draft.projectId,
    photos,
    savedAt: draft.updatedAt,
  };
}

/** GET /api/intake-draft – returns the user's saved draft or null. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loaded = await loadIntakeDraftWithPhotos(session.user.id);

  if (!loaded) {
    return NextResponse.json({ draft: null }, { status: 200 });
  }

  return NextResponse.json(serializeDraft(loaded.draft, loaded.photos), { status: 200 });
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
  const loaded = await loadIntakeDraftWithPhotos(session.user.id);

  return NextResponse.json(
    serializeDraft(draft, loaded?.photos ?? []),
    { status: 200 }
  );
}

/** DELETE /api/intake-draft – discard draft and shell project when still draft. */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteIntakeDraft(session.user.id);

  return NextResponse.json(result, { status: 200 });
}
