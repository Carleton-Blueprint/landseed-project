import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("IntakeLeaveGuard", () => {
  beforeEach(() => {
    mockUseIntakeDraft.mockReset();
  });

  it("does not warn on navigation while a submit is in progress, even with unsaved changes", async () => {
    const user = userEvent.setup();
    mockDraft({ isDirty: true, isSubmitting: true });

    render(
      <>
        <IntakeLeaveGuard />
        <a href="/dashboard">Leave</a>
      </>
    );

    await user.click(screen.getByRole("link", { name: /leave/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still warns on navigation with unsaved changes once submit is not in progress", async () => {
    const user = userEvent.setup();
    mockDraft({ isDirty: true, isSubmitting: false });

    render(
      <>
        <IntakeLeaveGuard />
        <a href="/dashboard">Leave</a>
      </>
    );

    await user.click(screen.getByRole("link", { name: /leave/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
