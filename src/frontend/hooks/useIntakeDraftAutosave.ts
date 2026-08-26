"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { GuidedData, IntakeData } from "@/backend/schemas/intakeDraft";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const EMPTY_SERIALIZED = stableSerialize(null);

export type DraftPhoto = {
  id: string;
  url: string;
  declaredModificationCodes: string[];
};

function normalizePhotos(photos: DraftPhoto[] | undefined): DraftPhoto[] {
  return (photos ?? []).map((photo) => ({
    ...photo,
    declaredModificationCodes: photo.declaredModificationCodes ?? [],
  }));
}

type IntakeDraftGetResponse =
  | { draft: null }
  | {
      draftId: string;
      guidedData: GuidedData | null;
      intakeData: IntakeData | null;
      projectId: string | null;
      photos: DraftPhoto[];
      savedAt: string;
    };

type IntakeDraftPatchResponse = {
  draftId: string;
  guidedData: GuidedData | null;
  intakeData: IntakeData | null;
  projectId: string | null;
  photos: DraftPhoto[];
  savedAt: string;
};

// Recursively sorts object keys before stringifying. guidedData/intakeData are
// stored as Postgres jsonb, which does not preserve object key insertion
// order, so a value echoed back from a save response can have keys in a
// different order than the client-built object it started from even when
// the content is identical. Plain JSON.stringify equality would treat that
// as a "change" forever, leaving isDirty stuck true after a successful
// save (the leave-guard's warning would then fire even though nothing was
// actually unsaved). Sorting keys deep makes the comparison content-based
// instead of order-based. Array element order is left untouched — jsonb
// does preserve that.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value ?? null));
}

function hasGuidedContent(data: GuidedData | null | undefined): boolean {
  if (!data) return false;
  return !!(
    data.mobilityAssistance ||
    (data.safetyFeatures && data.safetyFeatures.length > 0) ||
    data.bathroomModifications ||
    data.urgency ||
    data.additionalDetails?.trim()
  );
}

function hasIntakeContent(data: IntakeData | null | undefined): boolean {
  if (!data) return false;
  return !!(
    data.name?.trim() ||
    data.email?.trim() ||
    data.phone?.trim() ||
    data.addressLine1?.trim() ||
    data.addressLine2?.trim() ||
    data.city?.trim() ||
    data.postalCode?.trim() ||
    data.isCaregiver ||
    data.seniorName?.trim() ||
    data.relationshipToSenior?.trim() ||
    data.caregiverConsentConfirmed ||
    data.clientConsentConfirmed ||
    data.landlordName?.trim() ||
    data.landlordPhone?.trim() ||
    data.ownershipOtherDetails?.trim() ||
    (data.ownershipStatus && data.ownershipStatus !== "owner")
  );
}

export interface IntakeDraftAutosave {
  draftId: string | null;
  projectId: string | null;
  photos: DraftPhoto[];
  guidedData: GuidedData | null;
  intakeData: IntakeData | null;
  isHydrated: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isSubmitting: boolean;
  lastSaved: Date | null;
  saveError: string | null;
  restoredAt: Date | null;
  showNewProjectConfirm: boolean;
  setGuidedSnapshot: (data: GuidedData) => void;
  setIntakeSnapshot: (data: IntakeData) => void;
  ensureProjectId: () => Promise<string | null>;
  saveNow: () => Promise<void>;
  discardDraft: () => Promise<void>;
  confirmStartNew: () => Promise<void>;
  cancelStartNew: () => void;
  flushBeaconSave: () => void;
  addPhoto: (photo: DraftPhoto) => void;
  removePhoto: (photoId: string) => Promise<void>;
  toggleModificationCode: (photoId: string, code: string, checked: boolean) => Promise<void>;
  waitForPendingPhotoTagWrites: () => Promise<void>;
  setIsSubmitting: (submitting: boolean) => void;
}

export function useIntakeDraftAutosave(): IntakeDraftAutosave {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [guidedData, setGuidedData] = useState<GuidedData | null>(null);
  const [intakeData, setIntakeData] = useState<IntakeData | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false);

  const guidedSnapshotRef = useRef<GuidedData | null>(null);
  const intakeSnapshotRef = useRef<IntakeData | null>(null);
  const savedGuidedRef = useRef<string>(EMPTY_SERIALIZED);
  const savedIntakeRef = useRef<string>(EMPTY_SERIALIZED);
  const guidedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftEnsuredRef = useRef(false);
  const isHydratingRef = useRef(true);

  // Authoritative, synchronously-updated mirror of each photo's tag list.
  // React state updates aren't guaranteed to run synchronously within a
  // batch (e.g. several rapid checkbox toggles fired back to back), so
  // toggleModificationCode must never derive its next value by reading
  // `photos` state — it reads/writes this ref instead, then mirrors the
  // result into `photos` purely for rendering.
  const photoCodesRef = useRef<Map<string, string[]>>(new Map());

  function syncPhotoCodesRef(list: DraftPhoto[]) {
    const map = new Map<string, string[]>();
    for (const photo of list) map.set(photo.id, photo.declaredModificationCodes);
    photoCodesRef.current = map;
  }

  const computeIsDirty = useCallback(() => {
    const guidedDirty =
      guidedSnapshotRef.current !== null &&
      stableSerialize(guidedSnapshotRef.current) !== savedGuidedRef.current;
    const intakeDirty =
      intakeSnapshotRef.current !== null &&
      stableSerialize(intakeSnapshotRef.current) !== savedIntakeRef.current;
    return guidedDirty || intakeDirty;
  }, []);

  const [isDirty, setIsDirty] = useState(false);

  const refreshDirty = useCallback(() => {
    setIsDirty(computeIsDirty());
  }, [computeIsDirty]);

  const applySaveMetadata = useCallback(
    (data: IntakeDraftPatchResponse) => {
      const normalizedPhotos = normalizePhotos(data.photos);
      setDraftId(data.draftId);
      setProjectId(data.projectId);
      setPhotos(normalizedPhotos);
      syncPhotoCodesRef(normalizedPhotos);
      setLastSaved(new Date(data.savedAt));
      savedGuidedRef.current = stableSerialize(data.guidedData);
      savedIntakeRef.current = stableSerialize(data.intakeData);
      refreshDirty();
    },
    [refreshDirty]
  );

  const hydrateFromServer = useCallback(
    (data: {
      draftId: string;
      guidedData: GuidedData | null;
      intakeData: IntakeData | null;
      projectId: string | null;
      photos: DraftPhoto[];
      savedAt: string;
    }) => {
      const normalizedPhotos = normalizePhotos(data.photos);
      setDraftId(data.draftId);
      setProjectId(data.projectId);
      setPhotos(normalizedPhotos);
      syncPhotoCodesRef(normalizedPhotos);
      setGuidedData(data.guidedData);
      setIntakeData(data.intakeData);
      setLastSaved(new Date(data.savedAt));
      setRestoredAt(new Date(data.savedAt));
      savedGuidedRef.current = stableSerialize(data.guidedData);
      savedIntakeRef.current = stableSerialize(data.intakeData);
      guidedSnapshotRef.current = data.guidedData;
      intakeSnapshotRef.current = data.intakeData;
      draftEnsuredRef.current = true;
      refreshDirty();
    },
    [refreshDirty]
  );

  // Discards the saved draft (and its shell project, server-side) and
  // resets every piece of local state back to blank so the form renders
  // empty without a page reload — used when the user explicitly asks to
  // start a new project rather than resume the one in progress.
  const discardDraft = useCallback(async () => {
    if (guidedTimerRef.current) clearTimeout(guidedTimerRef.current);
    if (intakeTimerRef.current) clearTimeout(intakeTimerRef.current);

    await fetch("/api/intake-draft", { method: "DELETE" });

    guidedSnapshotRef.current = null;
    intakeSnapshotRef.current = null;
    savedGuidedRef.current = EMPTY_SERIALIZED;
    savedIntakeRef.current = EMPTY_SERIALIZED;
    draftEnsuredRef.current = false;
    photoCodesRef.current = new Map();

    setDraftId(null);
    setProjectId(null);
    setPhotos([]);
    setGuidedData(null);
    setIntakeData(null);
    setIsDirty(false);
    setLastSaved(null);
    setSaveError(null);
    setRestoredAt(null);
  }, []);

  // Strips the ?new=1 query param (added by "Start New Project" links) once
  // it has been acted on, so a page refresh doesn't re-trigger the discard
  // flow or the confirm modal.
  const stripNewParam = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("new");
    const qs = nextParams.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [router, searchParams]);

  // User confirmed "Discard your in-progress draft and start over?" — wipe it
  // for real and clear the query param so a refresh doesn't reopen the modal.
  const confirmStartNew = useCallback(async () => {
    await discardDraft();
    setShowNewProjectConfirm(false);
    stripNewParam();
  }, [discardDraft, stripNewParam]);

  // User backed out of discarding — leave the already-hydrated draft alone
  // and just drop the query param so the page reads as a normal visit to "/".
  const cancelStartNew = useCallback(() => {
    setShowNewProjectConfirm(false);
    stripNewParam();
  }, [stripNewParam]);

  const ensureDraft = useCallback(async () => {
    if (draftEnsuredRef.current && draftId) {
      return draftId;
    }

    const res = await fetch("/api/intake-draft", { method: "POST" });
    if (!res.ok) {
      throw new Error("Failed to create intake draft");
    }

    const data = (await res.json()) as IntakeDraftPatchResponse;
    draftEnsuredRef.current = true;
    applySaveMetadata(data);
    return data.draftId;
  }, [applySaveMetadata, draftId]);

  const patchDraft = useCallback(
    async (body: { guidedData?: GuidedData; intakeData?: IntakeData }) => {
      await ensureDraft();
      setIsSaving(true);
      setSaveError(null);

      try {
        const res = await fetch("/api/intake-draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          throw new Error("Failed to save draft");
        }

        const data = (await res.json()) as IntakeDraftPatchResponse;
        applySaveMetadata(data);
      } catch {
        setSaveError("Could not save draft. Please try again.");
        throw new Error("Failed to save draft");
      } finally {
        setIsSaving(false);
      }
    },
    [applySaveMetadata, ensureDraft]
  );

  const flushGuidedSave = useCallback(async () => {
    if (!hasGuidedContent(guidedSnapshotRef.current)) return;
    if (stableSerialize(guidedSnapshotRef.current) === savedGuidedRef.current) return;
    await patchDraft({ guidedData: guidedSnapshotRef.current! });
  }, [patchDraft]);

  const flushIntakeSave = useCallback(async () => {
    if (!hasIntakeContent(intakeSnapshotRef.current)) return;
    if (stableSerialize(intakeSnapshotRef.current) === savedIntakeRef.current) return;
    await patchDraft({ intakeData: intakeSnapshotRef.current! });
  }, [patchDraft]);

  const scheduleGuidedSave = useCallback(() => {
    if (isHydratingRef.current) return;
    refreshDirty();
    if (guidedTimerRef.current) clearTimeout(guidedTimerRef.current);
    guidedTimerRef.current = setTimeout(() => {
      void flushGuidedSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushGuidedSave, refreshDirty]);

  const scheduleIntakeSave = useCallback(() => {
    if (isHydratingRef.current) return;
    refreshDirty();
    if (intakeTimerRef.current) clearTimeout(intakeTimerRef.current);
    intakeTimerRef.current = setTimeout(() => {
      void flushIntakeSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushIntakeSave, refreshDirty]);

  const setGuidedSnapshot = useCallback(
    (data: GuidedData) => {
      if (isHydratingRef.current) return;

      const serialized = stableSerialize(data);
      if (serialized === savedGuidedRef.current) return;
      if (serialized === stableSerialize(guidedSnapshotRef.current)) return;
      if (!hasGuidedContent(data)) return;

      guidedSnapshotRef.current = data;
      void ensureDraft().catch(() => {
        setSaveError("Could not save draft. Please try again.");
      });
      scheduleGuidedSave();
    },
    [ensureDraft, scheduleGuidedSave]
  );

  const setIntakeSnapshot = useCallback(
    (data: IntakeData) => {
      if (isHydratingRef.current) return;

      const serialized = stableSerialize(data);
      if (serialized === savedIntakeRef.current) return;
      if (serialized === stableSerialize(intakeSnapshotRef.current)) return;
      if (!hasIntakeContent(data)) return;

      intakeSnapshotRef.current = data;
      void ensureDraft().catch(() => {
        setSaveError("Could not save draft. Please try again.");
      });
      scheduleIntakeSave();
    },
    [ensureDraft, scheduleIntakeSave]
  );

  const buildPendingPatchBody = useCallback(() => {
    const body: { guidedData?: GuidedData; intakeData?: IntakeData } = {};
    if (
      hasGuidedContent(guidedSnapshotRef.current) &&
      stableSerialize(guidedSnapshotRef.current) !== savedGuidedRef.current
    ) {
      body.guidedData = guidedSnapshotRef.current!;
    }
    if (
      hasIntakeContent(intakeSnapshotRef.current) &&
      stableSerialize(intakeSnapshotRef.current) !== savedIntakeRef.current
    ) {
      body.intakeData = intakeSnapshotRef.current!;
    }
    return body;
  }, []);

  const saveNow = useCallback(async () => {
    if (guidedTimerRef.current) clearTimeout(guidedTimerRef.current);
    if (intakeTimerRef.current) clearTimeout(intakeTimerRef.current);

    const body = buildPendingPatchBody();
    if (!body.guidedData && !body.intakeData) {
      if (hasGuidedContent(guidedSnapshotRef.current)) {
        body.guidedData = guidedSnapshotRef.current!;
      }
      if (hasIntakeContent(intakeSnapshotRef.current)) {
        body.intakeData = intakeSnapshotRef.current!;
      }
    }

    if (!body.guidedData && !body.intakeData) return;

    await patchDraft(body);
  }, [buildPendingPatchBody, patchDraft]);

  const flushBeaconSave = useCallback(() => {
    const body = buildPendingPatchBody();
    if (!body.guidedData && !body.intakeData) return;

    void fetch("/api/intake-draft", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  }, [buildPendingPatchBody]);

  const ensureProjectId = useCallback(async () => {
    if (projectId) return projectId;

    await ensureDraft();
    const res = await fetch("/api/intake-draft/shell-project", { method: "POST" });
    if (!res.ok) {
      setSaveError("Could not prepare photo upload. Please try again.");
      return null;
    }

    const data = (await res.json()) as { projectId: string; draftId: string };
    setProjectId(data.projectId);
    setDraftId(data.draftId);
    return data.projectId;
  }, [ensureDraft, projectId]);

  const addPhoto = useCallback((photo: DraftPhoto) => {
    setPhotos((prev) => {
      if (prev.some((p) => p.id === photo.id)) return prev;
      const next = [...prev, photo];
      syncPhotoCodesRef(next);
      return next;
    });
  }, []);

  const removePhoto = useCallback(async (photoId: string) => {
    const res = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error("Failed to remove photo");
    }

    setPhotos((prev) => {
      const next = prev.filter((photo) => photo.id !== photoId);
      syncPhotoCodesRef(next);
      return next;
    });
  }, []);

  // Per-photo FIFO queue: rapid checkbox toggles on the same photo (e.g. tagging
  // 3 modification types back to back) must never overwrite each other. Each
  // toggle reads/writes photoCodesRef synchronously — never React state, whose
  // setState updater isn't guaranteed to run synchronously within a batch — so
  // back-to-back toggles in the same tick always build on one another. The
  // network PATCH for a given photo is serialized through this queue so
  // responses can't land out of order, and a response is only mirrored into
  // local state if no newer toggle for that photo has been queued since
  // (otherwise it would clobber that later, more-current value with stale
  // server data).
  const photoTagQueueRef = useRef<Map<string, Promise<void>>>(new Map());

  const toggleModificationCode = useCallback(
    (photoId: string, code: string, checked: boolean): Promise<void> => {
      const currentCodes = photoCodesRef.current.get(photoId);
      if (currentCodes === undefined) return Promise.resolve();

      const nextCodes = checked
        ? Array.from(new Set([...currentCodes, code]))
        : currentCodes.filter((c) => c !== code);

      photoCodesRef.current.set(photoId, nextCodes);
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === photoId ? { ...photo, declaredModificationCodes: nextCodes } : photo
        )
      );

      const previousTask = photoTagQueueRef.current.get(photoId) ?? Promise.resolve();
      const task: Promise<void> = previousTask.catch(() => {}).then(async () => {
        const res = await fetch(`/api/photos/${photoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modificationItems: nextCodes }),
        });

        if (!res.ok) {
          throw new Error("Failed to update photo tags");
        }

        const data = (await res.json()) as {
          photo: { id: string; declaredModificationCodes: string[] };
        };

        if (photoTagQueueRef.current.get(photoId) === task) {
          photoCodesRef.current.set(photoId, data.photo.declaredModificationCodes);
          setPhotos((prev) =>
            prev.map((photo) =>
              photo.id === photoId
                ? { ...photo, declaredModificationCodes: data.photo.declaredModificationCodes }
                : photo
            )
          );
        }
      });

      photoTagQueueRef.current.set(photoId, task);
      return task;
    },
    []
  );

  // Submit must never promote a draft while a photo-tag PATCH triggered by a
  // just-clicked checkbox is still queued/in flight — otherwise it could
  // finalize the project before that tag write lands.
  const waitForPendingPhotoTagWrites = useCallback(async () => {
    await Promise.allSettled(Array.from(photoTagQueueRef.current.values()));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDraft() {
      try {
        const wantsNew = searchParams.get("new") === "1";

        const res = await fetch("/api/intake-draft");
        if (!res.ok) {
          throw new Error("Failed to load draft");
        }

        const data = (await res.json()) as IntakeDraftGetResponse;
        if (cancelled) return;

        if (!("draft" in data)) {
          const hasContent =
            hasGuidedContent(data.guidedData) ||
            hasIntakeContent(data.intakeData) ||
            data.photos.length > 0;

          if (wantsNew && hasContent) {
            // There's something worth losing — hydrate it so the form (and
            // the confirm modal's "from [restoredAt]" copy) has it ready,
            // then wait for the user's decision instead of wiping silently.
            hydrateFromServer(data);
            setShowNewProjectConfirm(true);
            return;
          }

          if (wantsNew) {
            // Nothing worth keeping — discard (idempotent) and move on.
            await discardDraft();
            if (cancelled) return;
            stripNewParam();
            return;
          }

          hydrateFromServer(data);
          return;
        }

        // No draft exists server-side at all.
        if (wantsNew) {
          await discardDraft();
          if (cancelled) return;
          stripNewParam();
        }
      } catch {
        if (!cancelled) {
          setSaveError("Could not load saved draft.");
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
          isHydratingRef.current = false;
        }
      }
    }

    void loadDraft();

    return () => {
      cancelled = true;
      if (guidedTimerRef.current) clearTimeout(guidedTimerRef.current);
      if (intakeTimerRef.current) clearTimeout(intakeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateFromServer, discardDraft]);

  return {
    draftId,
    projectId,
    photos,
    guidedData,
    intakeData,
    isHydrated,
    isDirty,
    isSaving,
    isSubmitting,
    lastSaved,
    saveError,
    restoredAt,
    showNewProjectConfirm,
    setGuidedSnapshot,
    setIntakeSnapshot,
    ensureProjectId,
    saveNow,
    discardDraft,
    confirmStartNew,
    cancelStartNew,
    flushBeaconSave,
    addPhoto,
    removePhoto,
    toggleModificationCode,
    waitForPendingPhotoTagWrites,
    setIsSubmitting,
  };
}
