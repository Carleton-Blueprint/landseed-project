import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { GuidedIntakeForm } from "../GuidedIntakeForm";

const mockFetch = jest.fn();

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
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
        json: async () => ({
          draftId: "draft-1",
          guidedData: null,
          intakeData: null,
          projectId: null,
          photos: [],
          savedAt: "2026-06-20T12:00:00.000Z",
        }),
      });
    }
    if (url === "/api/intake-draft" && init?.method === "PATCH") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          draftId: "draft-1",
          guidedData: JSON.parse(init.body as string).guidedData,
          intakeData: null,
          projectId: null,
          photos: [],
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

describe("GuidedIntakeForm", () => {
  it("PATCHes guidedData after a field change", async () => {
    const user = userEvent.setup();
    render(
      <IntakeDraftProvider>
        <GuidedIntakeForm />
      </IntakeDraftProvider>
    );

    await waitFor(() =>
      expect(mockFetch.mock.calls.some((call) => call[0] === "/api/intake-draft")).toBe(true)
    );

    await user.click(screen.getAllByRole("radio", { name: "Yes" })[0]);

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    await waitFor(
      () => {
        const patchCall = mockFetch.mock.calls.find(
          (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
        );
        expect(patchCall).toBeDefined();
        expect(JSON.parse(patchCall![1]!.body as string)).toEqual(
          expect.objectContaining({
            guidedData: expect.objectContaining({ mobilityAssistance: "yes" }),
          })
        );
      },
      { timeout: 3000 }
    );
  });
});
