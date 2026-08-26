import React from "react";
import { render, screen } from "@testing-library/react";
import { Navigation } from "../Navigation";
import { useSession } from "next-auth/react";
import "@testing-library/jest-dom";

// Mock next/link because it's used in the component
jest.mock("next/link", () => {
  const MockLink = ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
    return <a href={href} {...rest}>{children}</a>;
  };
  MockLink.displayName = "MockLink";
  return MockLink;
});

// Mock next/navigation hooks
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// Mock useSession hook
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(),
}));

describe("Navigation Component Role Guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders standard navigation links and hides Advisor Panel for non-admin users", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: {
          id: "user-123",
          name: "Alice User",
          email: "alice@example.com",
          role: "USER",
        },
      },
      status: "authenticated",
    });

    render(<Navigation />);

    // Verify basic links are shown
    expect(screen.getByText("Project Tracker")).toBeInTheDocument();

    // Verify Advisor Panel is NOT shown
    expect(screen.queryByText("Advisor Panel")).not.toBeInTheDocument();
  });

  it("renders Advisor Panel link for administrative users", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: {
          id: "admin-123",
          name: "Advisory Team member",
          email: "admin@example.com",
          role: "ADMIN",
        },
      },
      status: "authenticated",
    });

    render(<Navigation />);

    // Verify basic links + Advisor Panel are shown
    expect(screen.getByText("Project Tracker")).toBeInTheDocument();
    expect(screen.getByText("Advisor Panel")).toBeInTheDocument();
  });

  it("shows a Sign in icon link for unauthenticated users", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    render(<Navigation />);

    expect(screen.getByTitle("Sign in")).toBeInTheDocument();
    expect(screen.getByTitle("Sign in")).toHaveAttribute("href", "/auth/signin");
    expect(screen.queryByText("Project Tracker")).not.toBeInTheDocument();
    expect(screen.queryByText("Share Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Advisor Panel")).not.toBeInTheDocument();
    expect(screen.queryByTitle("My Profile")).not.toBeInTheDocument();
  });

  it("shows the profile avatar for authenticated users", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: {
          id: "user-123",
          name: "Alice User",
          email: "alice@example.com",
          role: "USER",
        },
      },
      status: "authenticated",
    });

    render(<Navigation />);

    expect(screen.getByTitle("My Profile")).toBeInTheDocument();
    expect(screen.getByTitle("My Profile")).toHaveTextContent("AU");
  });

  it("falls back to email initials when the user has no name", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: {
        user: {
          id: "user-456",
          name: null,
          email: "bob@example.com",
          role: "USER",
        },
      },
      status: "authenticated",
    });

    render(<Navigation />);

    expect(screen.getByTitle("My Profile")).toHaveTextContent("BO");
  });
});
