import { renderHook, act, waitFor } from "@testing-library/react";
import { useIntakeDraftAutosave } from "../useIntakeDraftAutosave";
import type { IntakeData } from "@/backend/schemas/intakeDraft";

const mockRouterReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockRouterReplace }),
  useSearchParams: () => mockSearchParams,
}));

const mockFetch = jest.fn();

const baseIntakeData: IntakeData = {
  name: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "ON",
  postalCode: "",
  ownershipStatus: "owner",
  ownershipOtherDetails: "",
  landlordName: "",
  landlordPhone: "",
  isCaregiver: false,
  seniorName: "",
  relationshipToSenior: "",
  caregiverConsentConfirmed: false,
  clientConsentConfirmed: false,
};

const baseDraftResponse = {
  draftId: "draft-1",
  guidedData: null as Record<string, unknown> | null,
  intakeData: null as Record<string, unknown> | null,
  projectId: null,
  photos: [],
  savedAt: "2026-06-20T12:00:00.000Z",
};

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockRouterReplace.mockReset();
  mockSearchParams = new URLSearchParams();
  global.fetch = mockFetch as typeof fetch;

  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/intake-draft" && !init?.method) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ draft: null }),
      });
    }
    if (url === "/api/intake-draft" && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...baseDraftResponse }),
      });
    }
    if (url === "/api/intake-draft" && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...baseDraftResponse,
          guidedData: body.guidedData ?? null,
          intakeData: body.intakeData ?? null,
          savedAt: "2026-06-20T12:01:00.000Z",
        }),
      });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useIntakeDraftAutosave", () => {
  it("loads an existing draft on mount", async () => {
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            draftId: "draft-1",
            guidedData: { mobilityAssistance: "yes" },
            intakeData: { name: "Jane" },
            projectId: "project-1",
            photos: [],
            savedAt: "2026-06-20T12:00:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(result.current.draftId).toBe("draft-1");
    expect(result.current.guidedData).toEqual({ mobilityAssistance: "yes" });
  });

  it("debounces guided PATCH saves", async () => {
    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setGuidedSnapshot({ mobilityAssistance: "yes" });
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(patchCall![1]!.body as string)).toEqual({
        guidedData: { mobilityAssistance: "yes" },
      });
    });
  });

  it("saveNow PATCHes immediately without waiting for debounce", async () => {
    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setIntakeSnapshot({ ...baseIntakeData, name: "Jane" });
    });

    await act(async () => {
      await result.current.saveNow();
    });

    const patchCalls = mockFetch.mock.calls.filter(
      (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
    );
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(patchCalls[patchCalls.length - 1][1]?.body as string)).toEqual(
      expect.objectContaining({ intakeData: { ...baseIntakeData, name: "Jane" } })
    );
  });

  it("isDirty resolves to false after saving even if the response echoes guidedData back with keys in a different order", async () => {
    // Postgres jsonb does not preserve object key insertion order, so the
    // save response can come back with keys reordered relative to what the
    // client sent even though the content is unchanged. The dirty check
    // must treat that as "saved", not as a fresh change.
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => ({ draft: null }) });
      }
      if (url === "/api/intake-draft" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ ...baseDraftResponse }) });
      }
      if (url === "/api/intake-draft" && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        const reorderedGuidedData = body.guidedData
          ? Object.fromEntries(Object.entries(body.guidedData).reverse())
          : null;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...baseDraftResponse,
            guidedData: reorderedGuidedData,
            intakeData: body.intakeData ?? null,
            savedAt: "2026-06-20T12:01:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setGuidedSnapshot({
        mobilityAssistance: "yes",
        safetyFeatures: ["grab-bars"],
        bathroomModifications: "no",
        urgency: "soon",
      });
    });

    await act(async () => {
      await result.current.saveNow();
    });

    expect(result.current.isDirty).toBe(false);
  });

  it("does not PATCH when the debounced snapshot matches the last saved state", async () => {
    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setGuidedSnapshot({ mobilityAssistance: "yes" });
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.filter(
          (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
        ).length
      ).toBe(1);
    });

    mockFetch.mockClear();

    act(() => {
      result.current.setGuidedSnapshot({ mobilityAssistance: "yes" });
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(
      mockFetch.mock.calls.filter(
        (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
      ).length
    ).toBe(0);
  });

  it("toggleModificationCode PATCHes the photo and updates local state", async () => {
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            draftId: "draft-1",
            guidedData: null,
            intakeData: null,
            projectId: "project-1",
            photos: [{ id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: [] }],
            savedAt: "2026-06-20T12:00:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      expect(url).toBe("/api/photos/photo-1");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(init?.body as string)).toEqual({ modificationItems: ["GRAB_BARS"] });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          photo: { id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] },
        }),
      });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.photos).toEqual([
      { id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: [] },
    ]);

    await act(async () => {
      await result.current.toggleModificationCode("photo-1", "GRAB_BARS", true);
    });

    expect(result.current.photos).toEqual([
      { id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: ["GRAB_BARS"] },
    ]);
  });

  it("toggleModificationCode does not lose picks when 3 codes are toggled in rapid succession", async () => {
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            draftId: "draft-1",
            guidedData: null,
            intakeData: null,
            projectId: "project-1",
            photos: [{ id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: [] }],
            savedAt: "2026-06-20T12:00:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    // Each photo PATCH is held open under manual control so the test can
    // resolve them out of order, mimicking real network jitter across 3 rapid
    // checkbox clicks on the same photo.
    type PendingPatch = {
      modificationItems: string[];
      resolve: (value: { ok: true; json: () => Promise<unknown> }) => void;
    };
    const pendingPatches: PendingPatch[] = [];

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/photos/photo-1" && init?.method === "PATCH") {
        const { modificationItems } = JSON.parse(init.body as string) as {
          modificationItems: string[];
        };
        return new Promise((resolve) => {
          pendingPatches.push({ modificationItems, resolve });
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let p1!: Promise<void>, p2!: Promise<void>, p3!: Promise<void>;
    act(() => {
      p1 = result.current.toggleModificationCode("photo-1", "GRAB_BARS", true);
      p2 = result.current.toggleModificationCode("photo-1", "RAMP", true);
      p3 = result.current.toggleModificationCode("photo-1", "STAIR_LIFT", true);
    });

    // The optimistic update must include all 3 picks immediately, before any
    // network response has resolved.
    expect(result.current.photos[0].declaredModificationCodes).toEqual(
      expect.arrayContaining(["GRAB_BARS", "RAMP", "STAIR_LIFT"])
    );

    // Fake timers block waitFor's own polling, so drain the microtask queue
    // by hand between each manually-controlled PATCH resolution below.
    const flushMicrotasks = async () => {
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          await Promise.resolve();
        }
      });
    };

    // The per-photo queue serializes the actual network calls, so only the
    // first PATCH should be in flight at this point.
    await flushMicrotasks();
    expect(pendingPatches.length).toBe(1);

    // Resolve the first request; this unblocks the queue and fires the second.
    pendingPatches[0].resolve({
      ok: true,
      json: async () => ({
        success: true,
        photo: { id: "photo-1", declaredModificationCodes: pendingPatches[0].modificationItems },
      }),
    });
    await flushMicrotasks();
    expect(pendingPatches.length).toBe(2);

    pendingPatches[1].resolve({
      ok: true,
      json: async () => ({
        success: true,
        photo: { id: "photo-1", declaredModificationCodes: pendingPatches[1].modificationItems },
      }),
    });
    await flushMicrotasks();
    expect(pendingPatches.length).toBe(3);

    pendingPatches[2].resolve({
      ok: true,
      json: async () => ({
        success: true,
        photo: { id: "photo-1", declaredModificationCodes: pendingPatches[2].modificationItems },
      }),
    });

    await act(async () => {
      await Promise.all([p1, p2, p3]);
    });

    expect(result.current.photos[0].declaredModificationCodes).toEqual(
      expect.arrayContaining(["GRAB_BARS", "RAMP", "STAIR_LIFT"])
    );
    expect(result.current.photos[0].declaredModificationCodes).toHaveLength(3);
  });

  it("waitForPendingPhotoTagWrites resolves only after the in-flight photo PATCH settles", async () => {
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            draftId: "draft-1",
            guidedData: null,
            intakeData: null,
            projectId: "project-1",
            photos: [{ id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: [] }],
            savedAt: "2026-06-20T12:00:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    let resolvePatch!: (value: { ok: true; json: () => Promise<unknown> }) => void;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/photos/photo-1" && init?.method === "PATCH") {
        return new Promise((resolve) => {
          resolvePatch = resolve;
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      void result.current.toggleModificationCode("photo-1", "GRAB_BARS", true);
    });

    let settled = false;
    const wait = result.current.waitForPendingPhotoTagWrites().then(() => {
      settled = true;
    });

    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(settled).toBe(false);

    resolvePatch({
      ok: true,
      json: async () => ({
        success: true,
        photo: { id: "photo-1", declaredModificationCodes: ["GRAB_BARS"] },
      }),
    });

    await act(async () => {
      await wait;
    });
    expect(settled).toBe(true);
  });

  it("flushBeaconSave sends keepalive PATCH for unsaved changes", async () => {
    const { result } = renderHook(() => useIntakeDraftAutosave());

    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.setGuidedSnapshot({ mobilityAssistance: "yes" });
    });

    act(() => {
      result.current.flushBeaconSave();
    });

    const beaconCall = mockFetch.mock.calls.find(
      (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
    );
    expect(beaconCall).toBeDefined();
    expect(beaconCall?.[1]).toMatchObject({ keepalive: true });
  });

  it("discardDraft DELETEs the draft and resets local state to blank", async () => {
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            draftId: "draft-1",
            guidedData: { mobilityAssistance: "yes" },
            intakeData: { ...baseIntakeData, name: "Jane" },
            projectId: "project-1",
            photos: [{ id: "photo-1", url: "https://example.com/a.jpg", declaredModificationCodes: [] }],
            savedAt: "2026-06-20T12:00:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
      expect(url).toBe("/api/intake-draft");
      expect(init?.method).toBe("DELETE");
      return Promise.resolve({ ok: true, json: async () => ({ deleted: true }) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.draftId).toBe("draft-1");
    expect(result.current.restoredAt).not.toBeNull();

    await act(async () => {
      await result.current.discardDraft();
    });

    expect(result.current.draftId).toBeNull();
    expect(result.current.projectId).toBeNull();
    expect(result.current.photos).toEqual([]);
    expect(result.current.guidedData).toBeNull();
    expect(result.current.intakeData).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.restoredAt).toBeNull();
  });

  it("discards the draft and strips the query param when the URL has ?new=1", async () => {
    mockSearchParams = new URLSearchParams("new=1");

    let deleteCalled = false;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && init?.method === "DELETE") {
        deleteCalled = true;
        return Promise.resolve({ ok: true, json: async () => ({ deleted: true }) });
      }
      if (url === "/api/intake-draft" && !init?.method) {
        throw new Error("Should not hydrate from the server when ?new=1 is present");
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { result } = renderHook(() => useIntakeDraftAutosave());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(deleteCalled).toBe(true);
    expect(result.current.draftId).toBeNull();
    expect(result.current.guidedData).toBeNull();
    expect(result.current.intakeData).toBeNull();
    expect(mockRouterReplace).toHaveBeenCalledWith("/", { scroll: false });
  });
});
