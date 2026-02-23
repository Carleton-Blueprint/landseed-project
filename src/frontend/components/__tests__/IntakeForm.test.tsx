/**
 * Unit tests for IntakeForm: render check (name, email, phone, submit) and validation (required name).
 * Run with: npm run test (or test:watch).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeForm } from "../IntakeForm";

describe("IntakeForm", () => {
  it("renders form with name, email, phone fields and submit button", () => {
    render(<IntakeForm />);

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("shows validation error when name is empty and form is submitted", async () => {
    const user = userEvent.setup();
    render(<IntakeForm />);

    await user.click(screen.getByRole("button", { name: /submit/i }));

    await expect(screen.findByText(/name is required/i)).resolves.toBeInTheDocument();
  });
});
