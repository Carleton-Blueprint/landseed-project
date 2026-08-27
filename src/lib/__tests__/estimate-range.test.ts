import { getEstimateSummary } from "../estimate-range";

describe("getEstimateSummary", () => {
  it("shows the override total instead of the stale AI range when the quote has been overridden", () => {
    const summary = getEstimateSummary({
      status: "estimate_ready",
      quotes: [{ estimateMin: "285", estimateMax: "315", override: { total: "200" } }],
    });

    expect(summary.value).toBe("$200");
    expect(summary.explanation).toContain("updated by our advisory team");
  });

  it("shows the AI range when there is no override", () => {
    const summary = getEstimateSummary({
      status: "estimate_ready",
      quotes: [{ estimateMin: "285", estimateMax: "315", override: null }],
    });

    expect(summary.value).toBe("$285 – $315");
  });

  it("shows the pre-finalization message when the project is still a draft, even if a range exists", () => {
    const summary = getEstimateSummary({
      status: "draft",
      quotes: [{ estimateMin: "285", estimateMax: "315", override: null }],
    });

    expect(summary.value).toBe("Available after project finalization");
  });
});
