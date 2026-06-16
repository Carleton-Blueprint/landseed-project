import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminDashboardClient, SerializedProject } from "../AdminDashboardClient";
import "@testing-library/jest-dom";

// Mock next/link because it's used in the component
jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
  MockLink.displayName = "MockLink";
  return MockLink;
});

const mockProjects: SerializedProject[] = [
  {
    id: "proj-1",
    address: "123 Main St",
    status: "submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modificationType: "GRAB_BARS",
    hasManualReviewFlag: false,
    manualReviewReason: null,
    client: { id: "u-1", name: "Alice", email: "alice@example.com" },
    photoCount: 1,
    documentCount: 1,
    documentsPendingReview: 0,
    quote: {
      id: "q-1",
      subtotal: "150.00",
      total: "150.00",
      status: "PENDING",
      generatedAt: new Date().toISOString(),
      openQuestions: 0,
      estimateMin: "100.00",
      estimateMax: "200.00",
    },
    eligibility: null,
    builderTrendTransfer: null,
  },
  {
    id: "proj-2",
    address: "456 Oak Rd",
    status: "estimate_ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modificationType: "RAMPS",
    hasManualReviewFlag: true,
    manualReviewReason: "HIGH_COMPLEXITY",
    client: { id: "u-2", name: "Bob", email: "bob@example.com" },
    photoCount: 1,
    documentCount: 1,
    documentsPendingReview: 0,
    quote: {
      id: "q-2",
      subtotal: "250.00",
      total: "250.00",
      status: "ACCEPTED",
      generatedAt: new Date().toISOString(),
      openQuestions: 0,
      estimateMin: "100.00",
      estimateMax: "200.00",
    },
    eligibility: null,
    builderTrendTransfer: null,
  },
  {
    id: "proj-3",
    address: "789 Pine Ave",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modificationType: "STAIR_LIFT",
    hasManualReviewFlag: false,
    manualReviewReason: null,
    client: { id: "u-3", name: "Charlie", email: "charlie@example.com" },
    photoCount: 0,
    documentCount: 0,
    documentsPendingReview: 0,
    quote: null,
    eligibility: null,
    builderTrendTransfer: null,
  },
];

describe("Admin Dashboard Analytics", () => {
  it("computes and displays automation rate, pricing accuracy, and deviation on the analytics tab", () => {
    render(<AdminDashboardClient projects={mockProjects} userName="Test Advisor" />);

    // Default tab should be projects list
    expect(screen.getByText("Projects List")).toBeInTheDocument();
    expect(screen.getByText("123 Main St")).toBeInTheDocument();

    // Find the analytics tab and click it
    const analyticsTab = screen.getByRole("button", { name: /real-time analytics/i });
    fireEvent.click(analyticsTab);

    // Automation Rate: 2 / 3 automated = 66.7%
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("2 / 3 projects")).toBeInTheDocument();

    // Pricing Accuracy: 1 / 2 quotes in range = 50.0%
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 quotes")).toBeInTheDocument();

    // Average Deviation: (0% + 66.67%) / 2 = 33.3%
    expect(screen.getByText("±33.3%")).toBeInTheDocument();

    // Verification of flag trigger counts
    expect(screen.getByText("High Complexity Project")).toBeInTheDocument();
    expect(screen.getByText("1 trigger")).toBeInTheDocument();
  });
});
