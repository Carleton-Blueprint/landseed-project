import React from "react";
import { render, screen } from "@testing-library/react";
import { Navigation } from "../Navigation";
import { useSession } from "next-auth/react";
import "@testing-library/jest-dom";

// Mock next/link because it's used in the component
jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
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
    expect(screen.getByText("My Projects")).toBeInTheDocument();

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
    expect(screen.getByText("My Projects")).toBeInTheDocument();
    expect(screen.getByText("Advisor Panel")).toBeInTheDocument();
  });

  it("hides Advisor Panel link for unauthenticated users", () => {
    (useSession as jest.Mock).mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    const { container } = render(<Navigation />);

    // Verify component renders nothing (returns null)
    expect(container.firstChild).toBeNull();
  });
});
