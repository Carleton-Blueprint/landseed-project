import { renderHook, act, waitFor } from "@testing-library/react";
import { useIntakeDraftAutosave } from "../useIntakeDraftAutosave";

const mockFetch = jest.fn();

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
      result.current.setIntakeSnapshot({ name: "Jane" });
    });

    await act(async () => {
      await result.current.saveNow();
    });

    const patchCalls = mockFetch.mock.calls.filter(
      (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
    );
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(patchCalls[patchCalls.length - 1][1]?.body as string)).toEqual(
      expect.objectContaining({ intakeData: { name: "Jane" } })
    );
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
});
