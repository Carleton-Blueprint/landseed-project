import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeaveConfirmModal } from "../LeaveConfirmModal";

describe("LeaveConfirmModal", () => {
  it("renders stay and save actions when open", () => {
    render(
      <LeaveConfirmModal
        open
        isSaving={false}
        onStay={jest.fn()}
        onSaveAndLeave={jest.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stay on page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save and leave/i })).toBeInTheDocument();
  });

  it("calls onStay when stay is clicked", async () => {
    const user = userEvent.setup();
    const onStay = jest.fn();

    render(
      <LeaveConfirmModal
        open
        isSaving={false}
        onStay={onStay}
        onSaveAndLeave={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /stay on page/i }));
    expect(onStay).toHaveBeenCalledTimes(1);
  });

  it("calls onSaveAndLeave when save and leave is clicked", async () => {
    const user = userEvent.setup();
    const onSaveAndLeave = jest.fn();

    render(
      <LeaveConfirmModal
        open
        isSaving={false}
        onStay={jest.fn()}
        onSaveAndLeave={onSaveAndLeave}
      />
    );

    await user.click(screen.getByRole("button", { name: /save and leave/i }));
    expect(onSaveAndLeave).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(
      <LeaveConfirmModal
        open={false}
        isSaving={false}
        onStay={jest.fn()}
        onSaveAndLeave={jest.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
