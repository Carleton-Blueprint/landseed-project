import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import { MODIFICATION_COST_CATALOG } from "@/backend/services/modificationCostCatalog";

describe("MODIFICATION_COST_CATALOG", () => {
  it("has an entry for every known modification code", () => {
    expect(Object.keys(MODIFICATION_COST_CATALOG).sort()).toEqual(
      Object.values(MODIFICATION_CODES).sort()
    );
  });

  it("gives every entry a positive fallback price and non-empty label/query", () => {
    for (const entry of Object.values(MODIFICATION_COST_CATALOG)) {
      expect(entry.fallbackUnitPrice).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.searchQuery.length).toBeGreaterThan(0);
    }
  });

  it("uses a distinct search query per modification", () => {
    const queries = Object.values(MODIFICATION_COST_CATALOG).map((entry) => entry.searchQuery);
    expect(new Set(queries).size).toBe(queries.length);
  });
});
