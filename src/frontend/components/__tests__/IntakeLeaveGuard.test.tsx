import { render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import { IntakeLeaveGuard } from "../IntakeLeaveGuard";
import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";

jest.mock("@/frontend/contexts/IntakeDraftContext", () => ({
  useIntakeDraft: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

const mockUseIntakeDraft = useIntakeDraft as jest.Mock;

function mockDraft(overrides: Partial<ReturnType<typeof useIntakeDraft>>) {
  mockUseIntakeDraft.mockReturnValue({
    isDirty: false,
    isSaving: false,
    isSubmitting: false,
    saveNow: jest.fn().mockResolvedValue(undefined),
    flushBeaconSave: jest.fn(),
    ...overrides,
  });
}

// Injected via insertAdjacentHTML (rather than JSX) so this stand-in for an
// in-app nav link isn't picked up by the no-html-link-for-pages build lint —
// it exists purely so useIntakeLeaveGuard's document-level click listener has
// a same-origin link to intercept, matching the pattern already used in
// useIntakeLeaveGuard.test.ts.
function appendLeaveLink() {
  document.body.insertAdjacentHTML("beforeend", '<a href="/dashboard">Leave</a>');
  return document.querySelector("a")!;
}

function clickLeaveLink() {
  const link = appendLeaveLink();
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("IntakeLeaveGuard", () => {
  beforeEach(() => {
    mockUseIntakeDraft.mockReset();
  });

  afterEach(() => {
    document.querySelectorAll("a").forEach((a) => a.remove());
  });

  it("does not warn on navigation while a submit is in progress, even with unsaved changes", () => {
    mockDraft({ isDirty: true, isSubmitting: true });

    render(<IntakeLeaveGuard />);
    clickLeaveLink();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still warns on navigation with unsaved changes once submit is not in progress", () => {
    mockDraft({ isDirty: true, isSubmitting: false });

    render(<IntakeLeaveGuard />);
    clickLeaveLink();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
