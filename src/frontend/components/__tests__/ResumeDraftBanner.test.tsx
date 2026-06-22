import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";
import { ResumeDraftBanner } from "../ResumeDraftBanner";

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as typeof fetch;
});

describe("ResumeDraftBanner", () => {
  it("shows welcome back banner when a draft is restored", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        draftId: "draft-1",
        guidedData: { mobilityAssistance: "yes" },
        intakeData: null,
        projectId: null,
        photos: [],
        savedAt: "2026-06-20T12:00:00.000Z",
      }),
    });

    render(
      <IntakeDraftProvider>
        <ResumeDraftBanner />
      </IntakeDraftProvider>
    );

    expect(
      await screen.findByText(/welcome back — we saved your progress/i)
    ).toBeInTheDocument();
  });

  it("does not show banner when there is no saved draft", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ draft: null }),
    });

    render(
      <IntakeDraftProvider>
        <ResumeDraftBanner />
      </IntakeDraftProvider>
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        draftId: "draft-1",
        guidedData: null,
        intakeData: { name: "Jane" },
        projectId: null,
        photos: [],
        savedAt: "2026-06-20T12:00:00.000Z",
      }),
    });

    render(
      <IntakeDraftProvider>
        <ResumeDraftBanner />
      </IntakeDraftProvider>
    );

    expect(
      await screen.findByText(/welcome back — we saved your progress/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });
});
