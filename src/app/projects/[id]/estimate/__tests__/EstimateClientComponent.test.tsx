import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EstimateClientComponent, type EstimateTierOption } from "../EstimateClientComponent";

jest.mock("@/frontend/components/ConsultationScheduler", () => ({
  ConsultationScheduler: () => <div>Consultation Scheduler</div>,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

function buildTier(key: EstimateTierOption["key"], total: number): EstimateTierOption {
  return {
    key,
    label: key[0].toUpperCase() + key.slice(1),
    subtotal: total * 0.7,
    laborTotal: total * 0.2,
    markupTotal: total * 0.15,
    total,
    estimateMin: total * 0.95,
    estimateMax: total * 1.05,
    lineItems: [
      {
        description: "Walk-in shower",
        quantity: 1,
        pricingQuery: "Walk-in shower",
        pricingSource: "Home Depot",
        pricingLink: null,
        materialUnitCost: total * 0.5,
        materialTotal: total * 0.5,
        laborHours: 4,
        laborRate: total * 0.1,
        laborTotal: total * 0.2,
        markupPercentage: 0.15,
        markupTotal: total * 0.15,
        lineTotal: total,
      },
    ],
  };
}

const tiers: EstimateTierOption[] = [
  buildTier("economy", 1000),
  buildTier("standard", 1300),
  buildTier("premium", 1700),
];

describe("EstimateClientComponent tier selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not show a tier picker for a non-tiered estimate", () => {
    render(
      <EstimateClientComponent
        quoteId="quote-1"
        projectId="proj-1"
        initialStatus="PENDING"
        initialReason={null}
      />
    );

    expect(screen.queryByText("Choose Your Pricing Tier")).not.toBeInTheDocument();
  });

  it("shows all three tiers and defaults to standard", () => {
    render(
      <EstimateClientComponent
        quoteId="quote-1"
        projectId="proj-1"
        initialStatus="PENDING"
        initialReason={null}
        tiers={tiers}
      />
    );

    expect(screen.getByText("Choose Your Pricing Tier")).toBeInTheDocument();
    expect(screen.getByText("Economy")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();

    const standardCard = screen.getByRole("button", { name: /Standard/ });
    expect(standardCard).toHaveStyle({ border: "2px solid #4f46e5" });
  });

  it("sends the selected tier when accepting", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <EstimateClientComponent
        quoteId="quote-1"
        projectId="proj-1"
        initialStatus="PENDING"
        initialReason={null}
        tiers={tiers}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Premium/ }));
    fireEvent.click(screen.getByText("Accept Estimate"));
    fireEvent.click(screen.getByText("Yes, Accept Estimate"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quote/quote-1/respond",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ status: "ACCEPTED", reason: null, selectedTier: "premium" }),
      })
    );

    expect(await screen.findByText("Estimate Accepted")).toBeInTheDocument();
    expect(screen.getByText(/Premium/)).toBeInTheDocument();
  });

  it("does not include selectedTier when the estimate is not tiered", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <EstimateClientComponent
        quoteId="quote-1"
        projectId="proj-1"
        initialStatus="PENDING"
        initialReason={null}
      />
    );

    fireEvent.click(screen.getByText("Accept Estimate"));
    fireEvent.click(screen.getByText("Yes, Accept Estimate"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quote/quote-1/respond",
      expect.objectContaining({
        body: JSON.stringify({ status: "ACCEPTED", reason: null }),
      })
    );
  });
});
