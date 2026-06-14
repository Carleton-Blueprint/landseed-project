/**
 * Tests for GrantDiscoverySummary component.
 * Verifies rendering of assessment states, overall decision banner, grant cards, and metadata.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GrantDiscoverySummary } from "@/app/dashboard/[id]/GrantDiscoverySummary";

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("GrantDiscoverySummary", () => {
  const projectId = "test-project-123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows loading state initially", async () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves to keep loading state

    render(<GrantDiscoverySummary projectId={projectId} />);

    expect(screen.getByText("Loading Grant Assessment…")).toBeInTheDocument();
  });

  it("shows error state when API call fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<GrantDiscoverySummary projectId={projectId} />);

    await waitFor(() => {
      expect(screen.getByText("Grant Assessment Error")).toBeInTheDocument();
      expect(screen.getByText("Failed to load assessment (500)")).toBeInTheDocument();
    });
  });

  it("shows assessment pending state when assessment is not found (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    render(<GrantDiscoverySummary projectId={projectId} />);

    await waitFor(() => {
      expect(screen.getByText("AI Grant Assessment")).toBeInTheDocument();
      expect(screen.getByText("Assessment Pending")).toBeInTheDocument();
      expect(
        screen.getByText("Grant eligibility discovery will run automatically once your project is finalized.")
      ).toBeInTheDocument();
    });
  });

  it("renders discovered grants successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assessmentId: "assessment-1",
        overallDecision: "ELIGIBLE",
        createdAt: "2026-03-28T12:00:00Z",
        discovery: {
          provider: "OPENAI",
          metadata: {
            candidateCount: 10,
            returnedCount: 1,
          },
          discoveredGrants: [
            {
              grantId: "g-1",
              title: "HMSI Senior Independence Grant",
              scope: "PROVINCIAL",
              jurisdiction: "Ontario",
              sourceUrl: "https://example.com/hmsi",
              summary: "A provincial grant program for seniors home updates.",
              decision: "ELIGIBLE",
              relevanceScore: 95,
              confidence: "HIGH",
              matchedCriteria: ["Age >= 65"],
              missingCriteria: [],
              rationale: "Client meets all age and property criteria.",
            },
          ],
        },
      }),
    });

    render(<GrantDiscoverySummary projectId={projectId} />);

    await waitFor(() => {
      expect(screen.getByText("AI-Sourced Grant Discovery")).toBeInTheDocument();
      expect(screen.getAllByText("Eligible")[0]).toBeInTheDocument();
      expect(screen.getByText("HMSI Senior Independence Grant")).toBeInTheDocument();
      expect(screen.getByText("1 grant program evaluated")).toBeInTheDocument();
      expect(screen.getByText("Provider: OPENAI")).toBeInTheDocument();
      expect(screen.getByText("Candidates: 10")).toBeInTheDocument();
    });
  });

  it("can expand grant card to view details", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assessmentId: "assessment-1",
        overallDecision: "ELIGIBLE",
        createdAt: "2026-03-28T12:00:00Z",
        discovery: {
          provider: "OPENAI",
          discoveredGrants: [
            {
              grantId: "g-1",
              title: "HMSI Senior Independence Grant",
              scope: "PROVINCIAL",
              jurisdiction: "Ontario",
              sourceUrl: "https://example.com/hmsi",
              summary: "A provincial grant program.",
              decision: "ELIGIBLE",
              relevanceScore: 95,
              confidence: "HIGH",
              matchedCriteria: ["Age >= 65"],
              missingCriteria: ["Income proof"],
              rationale: "Client matches age requirement.",
            },
          ],
        },
      }),
    });

    render(<GrantDiscoverySummary projectId={projectId} />);

    await waitFor(() => {
      expect(screen.getByText("View details")).toBeInTheDocument();
    });

    // Rationale and criteria are hidden by default
    expect(screen.queryByText("Assessment Rationale")).not.toBeInTheDocument();

    // Click "View details" button to expand
    fireEvent.click(screen.getByText("View details"));

    expect(screen.getByText("Assessment Rationale")).toBeInTheDocument();
    expect(screen.getByText("“Client matches age requirement.”")).toBeInTheDocument();
    expect(screen.getByText("Matched Criteria")).toBeInTheDocument();
    expect(screen.getByText("Missing Criteria")).toBeInTheDocument();
    expect(screen.getByText("View source")).toBeInTheDocument();

    // Click "Hide details" to collapse
    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.queryByText("Assessment Rationale")).not.toBeInTheDocument();
  });
});
