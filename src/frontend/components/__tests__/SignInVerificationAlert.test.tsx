import { render, screen } from "@testing-library/react";
import { SignInVerificationAlert } from "../auth/SignInVerificationAlert";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
}));

import { useSearchParams } from "next/navigation";

describe("SignInVerificationAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when verified param is absent", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    const { container } = render(<SignInVerificationAlert />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a success message when verification succeeded", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams("verified=success"));
    render(<SignInVerificationAlert />);
    expect(screen.getByText(/your email is verified/i)).toBeInTheDocument();
  });

  it("renders an error message when verification link expired", () => {
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams("verified=expired"));
    render(<SignInVerificationAlert />);
    expect(screen.getByText(/verification link has expired/i)).toBeInTheDocument();
  });
});
