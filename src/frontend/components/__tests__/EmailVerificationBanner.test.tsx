import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmailVerificationBanner } from "../auth/EmailVerificationBanner";

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as typeof fetch;
});

describe("EmailVerificationBanner", () => {
  it("shows the user email and resend action", () => {
    render(<EmailVerificationBanner email="user@example.com" />);

    expect(screen.getByText(/please verify your email/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend verification email/i })
    ).toBeInTheDocument();
  });

  it("calls the resend verification API", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Verification email sent." }),
    });

    render(<EmailVerificationBanner email="user@example.com" />);
    await user.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/resend-verification", {
        method: "POST",
      });
    });
    expect(screen.getByText(/verification email sent/i)).toBeInTheDocument();
  });

  it("shows an error when resend fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Please wait before requesting another verification email." }),
    });

    render(<EmailVerificationBanner email="user@example.com" />);
    await user.click(screen.getByRole("button", { name: /resend verification email/i }));

    expect(
      await screen.findByText(/please wait before requesting another verification email/i)
    ).toBeInTheDocument();
  });
});
