import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GrantDiscoverySummary } from "../GrantDiscoverySummary";

const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockAssessment(staffOverridden?: boolean) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      assessmentId: "assessment-1",
      overallDecision: "ELIGIBLE",
      createdAt: "2026-10-30T12:00:00.000Z",
      ...(staffOverridden === undefined ? {} : { staffOverridden }),
      discovery: { provider: "OPENAI", discoveredGrants: [] },
    }),
  });
}

describe("GrantDiscoverySummary staff override line", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows 'Overridden by LandSeed staff' when the API reports the override's edits were applied", async () => {
    mockAssessment(true);

    render(<GrantDiscoverySummary projectId="proj-1" />);

    expect(await screen.findByText("Overridden by LandSeed staff")).toBeInTheDocument();
  });

  it.each([
    ["false (override made against an older assessment)", false],
    ["absent", undefined],
  ])("shows nothing about overrides when staffOverridden is %s", async (_label, staffOverridden) => {
    mockAssessment(staffOverridden);

    render(<GrantDiscoverySummary projectId="proj-1" />);

    expect(await screen.findByText("InPlace AI-Sourced Grant Discovery")).toBeInTheDocument();
    expect(screen.queryByText(/Overridden/)).not.toBeInTheDocument();
  });

  it("never shows admin names or override types", async () => {
    mockAssessment(true);

    const { container } = render(<GrantDiscoverySummary projectId="proj-1" />);

    await screen.findByText("Overridden by LandSeed staff");
    expect(container.textContent).not.toMatch(/ by (?!LandSeed staff)|Post-estimate|Pre-estimate|Re-assessed|Manual grants/);
  });
});
