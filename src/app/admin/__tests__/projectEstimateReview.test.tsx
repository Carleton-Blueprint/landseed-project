import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminDashboardClient, SerializedProject } from "../AdminDashboardClient";
import "@testing-library/jest-dom";

jest.mock("next/link", () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
  MockLink.displayName = "MockLink";
  return MockLink;
});

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({ data: null, status: "unauthenticated" })),
}));

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: mockRefresh,
  }),
}));

const mockProjectWithQuote: SerializedProject = {
  id: "proj-quote-1",
  address: "42 Ramp Lane",
  status: "ESTIMATE_READY",
  statusHistory: [],
  createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
  updatedAt: new Date("2026-08-01T10:00:00Z").toISOString(),
  modificationType: "GRAB_BARS",
  client: { id: "u-quote-1", name: "Iris Nolan", email: "iris@example.com" },
  photoCount: 1,
  documentCount: 0,
  documentsPendingReview: 0,
  quote: {
    id: "quote-1",
    subtotal: "100.00",
    total: "120.00",
    status: "PENDING",
    generatedAt: new Date("2026-08-01T11:00:00Z").toISOString(),
    openQuestions: 0,
    effectiveLineItems: [{ description: "Grab bars", quantity: 2, materialTotal: 40, laborTotal: 60 }],
    override: null,
  },
  eligibility: {
    id: "assessment-1",
    overallDecision: "MANUAL_REVIEW",
    discoveredGrants: [
      {
        grantId: "grant-ai-1",
        title: "Home Modification for Seniors Independence",
        scope: "PROVINCIAL",
        jurisdiction: "Ontario",
        decision: "ELIGIBLE",
        source: "ai",
        relevanceScore: 88,
        confidence: "HIGH",
        summary: "Funding for accessibility modifications.",
      },
    ],
    allGrantIds: ["grant-ai-1"],
    provider: "OPENAI",
    assessedAt: new Date("2026-08-01T11:00:00Z").toISOString(),
    isOverridden: false,
  },
  builderTrendTransfer: null,
  photos: [
    {
      id: "photo-1",
      url: "https://example.com/photo1.jpg",
      virus_scan_status: "clean",
      createdAt: new Date("2026-08-01T10:30:00Z").toISOString(),
      declaredModificationCodes: ["GRAB_BARS"],
      aiModificationCodes: ["GRAB_BARS"],
    },
  ],
};

function getOverrideCall(): [string, { body: string }] {
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
    String(url).endsWith("/quote-override")
  );
  if (!call) throw new Error("quote-override fetch was never called");
  return call as [string, { body: string }];
}

describe("ProjectEstimateReview (post-estimate override)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projectId: "proj-quote-1", quoteId: "quote-1", effective: {}, totalChanged: true }),
    }) as unknown as typeof fetch;
  });

  it("renders the effective total and grant eligibility once a quote exists", () => {
    render(<AdminDashboardClient projects={[mockProjectWithQuote]} userName="Advisor" />);
    fireEvent.click(screen.getByText("42 Ramp Lane"));

    expect(screen.getByText("Estimate Review & Override")).toBeInTheDocument();
    expect(screen.getAllByText("$120.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MANUAL_REVIEW").length).toBeGreaterThan(0);
  });

  it("requires a reason before allowing submission, and submits the expected payload", async () => {
    render(<AdminDashboardClient projects={[mockProjectWithQuote]} userName="Advisor" />);
    fireEvent.click(screen.getByText("42 Ramp Lane"));
    fireEvent.click(screen.getByText("Edit Estimate"));

    // Per-photo scope checkbox should be pre-checked for the AI-tagged code.
    const grabBarsCheckboxes = screen.getAllByLabelText(/Grab Bars/i);
    expect(grabBarsCheckboxes.length).toBeGreaterThan(0);

    // The AI-discovered grant should be listed (also appears in the collapsed summary card).
    expect(screen.getAllByText("Home Modification for Seniors Independence").length).toBeGreaterThan(0);

    const reviewButton = screen.getByRole("button", { name: "Review & Submit" });
    expect(reviewButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Explain why this estimate was manually adjusted..."), {
      target: { value: "Client called to request a manual price adjustment" },
    });

    expect(reviewButton).not.toBeDisabled();
    fireEvent.click(reviewButton);

    expect(screen.getByText("Confirm Estimate Override")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Override" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, init] = getOverrideCall();
    expect(url).toBe("/api/admin/projects/proj-quote-1/quote-override");
    const body = JSON.parse(init.body);
    expect(body.reason).toBe("Client called to request a manual price adjustment");
    expect(body.photoModifications).toEqual([{ photoId: "photo-1", declaredModificationCodes: ["GRAB_BARS"] }]);
    expect(body.grantChanges.decisionOverrides).toEqual([{ grantId: "grant-ai-1", decision: "ELIGIBLE" }]);
    expect(body.grantChanges.removedGrantIds).toEqual([]);
    expect(body.grantChanges.addedGrants).toEqual([]);

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removing the only AI grant reports it in removedGrantIds", async () => {
    render(<AdminDashboardClient projects={[mockProjectWithQuote]} userName="Advisor" />);
    fireEvent.click(screen.getByText("42 Ramp Lane"));
    fireEvent.click(screen.getByText("Edit Estimate"));

    fireEvent.click(screen.getByRole("button", { name: "Remove grant" }));
    fireEvent.change(screen.getByPlaceholderText("Explain why this estimate was manually adjusted..."), {
      target: { value: "Grant no longer applicable" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Override" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = getOverrideCall();
    const body = JSON.parse(init.body);
    expect(body.grantChanges.removedGrantIds).toEqual(["grant-ai-1"]);
    expect(body.grantChanges.decisionOverrides).toEqual([]);
  });
});
