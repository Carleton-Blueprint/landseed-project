import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewProjectConfirmModal } from "../NewProjectConfirmModal";
import { useIntakeDraft } from "@/frontend/contexts/IntakeDraftContext";

jest.mock("@/frontend/contexts/IntakeDraftContext", () => ({
  useIntakeDraft: jest.fn(),
}));

const mockUseIntakeDraft = useIntakeDraft as jest.Mock;

function mockDraft(overrides: Partial<ReturnType<typeof useIntakeDraft>>) {
  mockUseIntakeDraft.mockReturnValue({
    showNewProjectConfirm: false,
    restoredAt: null,
    confirmStartNew: jest.fn().mockResolvedValue(undefined),
    cancelStartNew: jest.fn(),
    ...overrides,
  });
}

describe("NewProjectConfirmModal", () => {
  beforeEach(() => {
    mockUseIntakeDraft.mockReset();
  });

  it("renders nothing when there is nothing pending confirmation", () => {
    mockDraft({ showNewProjectConfirm: false });

    render(<NewProjectConfirmModal />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the confirm dialog with the restored-at timestamp when pending", () => {
    mockDraft({
      showNewProjectConfirm: true,
      restoredAt: new Date("2026-06-20T12:00:00.000Z"),
    });

    render(<NewProjectConfirmModal />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep my draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard and start new/i })).toBeInTheDocument();
  });

  it("calls cancelStartNew when 'Keep my draft' is clicked", async () => {
    const user = userEvent.setup();
    const cancelStartNew = jest.fn();
    mockDraft({ showNewProjectConfirm: true, cancelStartNew });

    render(<NewProjectConfirmModal />);
    await user.click(screen.getByRole("button", { name: /keep my draft/i }));

    expect(cancelStartNew).toHaveBeenCalledTimes(1);
  });

  it("calls confirmStartNew when 'Discard and start new' is clicked", async () => {
    const user = userEvent.setup();
    const confirmStartNew = jest.fn().mockResolvedValue(undefined);
    mockDraft({ showNewProjectConfirm: true, confirmStartNew });

    render(<NewProjectConfirmModal />);
    await user.click(screen.getByRole("button", { name: /discard and start new/i }));

    expect(confirmStartNew).toHaveBeenCalledTimes(1);
  });
});
