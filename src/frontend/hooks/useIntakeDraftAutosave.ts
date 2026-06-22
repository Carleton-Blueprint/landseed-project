"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GuidedData, IntakeData } from "@/backend/schemas/intakeDraft";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const EMPTY_SERIALIZED = stableSerialize(null);

export type DraftPhoto = { id: string; url: string };

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

function stableSerialize(value: unknown): string {
  return JSON.stringify(value ?? null);
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
    (data.modificationItems && data.modificationItems.length > 0) ||
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
  lastSaved: Date | null;
  saveError: string | null;
  restoredAt: Date | null;
  setGuidedSnapshot: (data: GuidedData) => void;
  setIntakeSnapshot: (data: IntakeData) => void;
  ensureProjectId: () => Promise<string | null>;
  saveNow: () => Promise<void>;
  addPhoto: (photo: DraftPhoto) => void;
}

export function useIntakeDraftAutosave(): IntakeDraftAutosave {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [guidedData, setGuidedData] = useState<GuidedData | null>(null);
  const [intakeData, setIntakeData] = useState<IntakeData | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);

  const guidedSnapshotRef = useRef<GuidedData | null>(null);
  const intakeSnapshotRef = useRef<IntakeData | null>(null);
  const savedGuidedRef = useRef<string>(EMPTY_SERIALIZED);
  const savedIntakeRef = useRef<string>(EMPTY_SERIALIZED);
  const guidedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftEnsuredRef = useRef(false);
  const isHydratingRef = useRef(true);

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
      setDraftId(data.draftId);
      setProjectId(data.projectId);
      setPhotos(data.photos ?? []);
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
      setDraftId(data.draftId);
      setProjectId(data.projectId);
      setPhotos(data.photos ?? []);
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

  const saveNow = useCallback(async () => {
    if (guidedTimerRef.current) clearTimeout(guidedTimerRef.current);
    if (intakeTimerRef.current) clearTimeout(intakeTimerRef.current);

    const body: { guidedData?: GuidedData; intakeData?: IntakeData } = {};
    if (hasGuidedContent(guidedSnapshotRef.current)) {
      body.guidedData = guidedSnapshotRef.current!;
    }
    if (hasIntakeContent(intakeSnapshotRef.current)) {
      body.intakeData = intakeSnapshotRef.current!;
    }

    if (!body.guidedData && !body.intakeData) return;

    await patchDraft(body);
  }, [patchDraft]);

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
      return [...prev, photo];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDraft() {
      try {
        const res = await fetch("/api/intake-draft");
        if (!res.ok) {
          throw new Error("Failed to load draft");
        }

        const data = (await res.json()) as IntakeDraftGetResponse;
        if (cancelled) return;

        if (data.draft === null) {
          setIsHydrated(true);
          isHydratingRef.current = false;
          return;
        }

        hydrateFromServer(data);
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
  }, [hydrateFromServer]);

  return {
    draftId,
    projectId,
    photos,
    guidedData,
    intakeData,
    isHydrated,
    isDirty,
    isSaving,
    lastSaved,
    saveError,
    restoredAt,
    setGuidedSnapshot,
    setIntakeSnapshot,
    ensureProjectId,
    saveNow,
    addPhoto,
  };
}
