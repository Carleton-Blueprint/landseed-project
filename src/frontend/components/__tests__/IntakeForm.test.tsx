/**
 * Unit tests for IntakeForm: render check (name, email, phone, submit) and validation (required name).
 * Run with: npm run test (or test:watch).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}));

import { IntakeForm } from "../IntakeForm";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
}


describe("IntakeForm", () => {
  it("renders form with name, email, phone fields and submit button", () => {
    render(<IntakeForm />, { wrapper: createWrapper() });

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });

  it("shows validation errors when required fields are empty and form is submitted", async () => {
    const user = userEvent.setup();
    render(<IntakeForm />, { wrapper: createWrapper() });

    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(await screen.findByText(/phone is required/i)).toBeInTheDocument();
  });

  it("shows caregiver fields when caregiver checkbox is checked", async () => {
    const user = userEvent.setup();
    render(<IntakeForm />, { wrapper: createWrapper() });

    await user.click(
      screen.getByRole("checkbox", { name: /i am a caregiver submitting this request on behalf of a senior/i })
    );

    expect(screen.getByLabelText(/senior name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/relationship to senior/i)).toBeInTheDocument();
  });
});
