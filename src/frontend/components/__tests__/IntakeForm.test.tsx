/**
 * Unit tests for IntakeForm: render check (name, email, phone, submit) and validation (required name).
 * Run with: npm run test (or test:watch).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeDraftProvider } from "@/frontend/contexts/IntakeDraftContext";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as typeof fetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ draft: null }),
  });
});

import { IntakeForm } from "../IntakeForm";

function renderIntakeForm() {
  return render(
    <IntakeDraftProvider>
      <IntakeForm />
    </IntakeDraftProvider>
  );
}

describe("IntakeForm", () => {
  it("renders form with name, email, phone fields and submit button", async () => {
    renderIntakeForm();

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();

    await waitFor(() =>
      expect(mockFetch.mock.calls.some((call) => call[0] === "/api/intake-draft")).toBe(true)
    );
  });

  it("shows validation errors when required fields are empty and form is submitted", async () => {
    const user = userEvent.setup();
    renderIntakeForm();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/phone is required/i)).toBeInTheDocument();
  });

  it("shows caregiver fields when caregiver checkbox is checked", async () => {
    const user = userEvent.setup();
    renderIntakeForm();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.click(
      screen.getByRole("checkbox", {
        name: /i am a caregiver submitting this request on behalf of a senior/i,
      })
    );

    expect(screen.getByLabelText(/senior name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/relationship to senior/i)).toBeInTheDocument();
  });

  it("calls PATCH immediately when Save as Draft is clicked", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/intake-draft" && !init?.method) {
        return Promise.resolve({ ok: true, json: async () => ({ draft: null }) });
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
            guidedData: null,
            intakeData: JSON.parse(init.body as string).intakeData,
            projectId: null,
            photos: [],
            savedAt: "2026-06-20T12:01:00.000Z",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    renderIntakeForm();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/name/i), "Jane Doe");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/intake-draft" && call[1]?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
    });

    jest.useRealTimers();
  });
});
