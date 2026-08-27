import { computeModificationTotals, type RefinedEstimateLineItem } from "@/backend/services/refinedEstimate";
import { groupForDisplay } from "../groupForDisplay";

function lineItem(overrides: Partial<RefinedEstimateLineItem> = {}): RefinedEstimateLineItem {
  return {
    description: "Grab bars",
    quantity: 1,
    pricingQuery: "Grab bars",
    pricingSource: "Home Depot",
    pricingLink: null,
    modificationCode: "GRAB_BARS",
    modificationLabel: "Grab Bars",
    materialUnitCost: 100,
    materialTotal: 100,
    laborHours: 2,
    laborRate: 150,
    laborTotal: 300,
    markupPercentage: 0,
    markupTotal: 0,
    lineTotal: 400,
    ...overrides,
  };
}

function calloutFeeLineItem(): RefinedEstimateLineItem {
  return lineItem({
    description: "Service Call-Out Fee",
    modificationCode: null,
    modificationLabel: null,
    materialUnitCost: 0,
    materialTotal: 0,
    laborHours: 0,
    laborRate: 0,
    laborTotal: 150,
    lineTotal: 150,
    isCalloutFee: true,
  });
}

describe("groupForDisplay", () => {
  it("keeps the call-out fee visible as its own group instead of dropping it", () => {
    const items = [lineItem(), calloutFeeLineItem()];
    const groups = groupForDisplay(items, computeModificationTotals(items));

    const calloutGroup = groups.find((g) => g.modificationCode === "CALL_OUT_FEE");
    expect(calloutGroup).toBeDefined();
    expect(calloutGroup?.modificationLabel).toBe("Service Call-Out Fee");
    expect(calloutGroup?.lineItems).toHaveLength(1);
    expect(calloutGroup?.total).toBe(150);

    const grabBarsGroup = groups.find((g) => g.modificationCode === "GRAB_BARS");
    expect(grabBarsGroup?.lineItems).toHaveLength(1);

    const summedGroupTotal = groups.reduce((sum, g) => sum + g.total, 0);
    expect(summedGroupTotal).toBe(400 + 150);
  });

  it("omits the call-out fee group entirely when there is no call-out fee line item", () => {
    const items = [lineItem()];
    const groups = groupForDisplay(items, computeModificationTotals(items));

    expect(groups.some((g) => g.modificationCode === "CALL_OUT_FEE")).toBe(false);
  });

  it("does not double-count the call-out fee under UNSPECIFIED when it's the only unspecified-modification item", () => {
    const items = [lineItem(), calloutFeeLineItem()];
    const groups = groupForDisplay(items, computeModificationTotals(items));

    expect(groups.some((g) => g.modificationCode === "UNSPECIFIED")).toBe(false);
  });
});
