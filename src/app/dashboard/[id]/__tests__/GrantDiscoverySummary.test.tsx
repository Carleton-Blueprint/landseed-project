import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GrantDiscoverySummary } from "../GrantDiscoverySummary";

const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockAssessment() {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      assessmentId: "assessment-1",
      overallDecision: "ELIGIBLE",
      createdAt: "2026-10-30T12:00:00.000Z",
      discovery: { provider: "OPENAI", discoveredGrants: [] },
    }),
  });
}

describe("GrantDiscoverySummary staff override line", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows 'Overridden by LandSeed staff' when the latest quote has a post-estimate override", async () => {
    mockAssessment();

    render(<GrantDiscoverySummary projectId="proj-1" staffOverridden />);

    expect(await screen.findByText("Overridden by LandSeed staff")).toBeInTheDocument();
  });

  it("shows nothing about overrides by default", async () => {
    mockAssessment();

    render(<GrantDiscoverySummary projectId="proj-1" />);

    expect(await screen.findByText("InPlace AI-Sourced Grant Discovery")).toBeInTheDocument();
    expect(screen.queryByText(/Overridden/)).not.toBeInTheDocument();
  });

  it("never shows admin names or override types", async () => {
    mockAssessment();

    const { container } = render(<GrantDiscoverySummary projectId="proj-1" staffOverridden />);

    await screen.findByText("Overridden by LandSeed staff");
    expect(container.textContent).not.toMatch(/ by (?!LandSeed staff)|Post-estimate|Pre-estimate|Re-assessed|Manual grants/);
  });
});
