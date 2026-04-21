import {
  buildEstimateReadyIdempotencyKey,
  ESTIMATE_READY_REVIEW_STATE,
  ESTIMATE_READY_TRIGGER_SOURCE,
} from "../estimateReadyContract";

describe("estimateReadyContract", () => {
  it("uses READY_FOR_REVIEW as the contract review state", () => {
    expect(ESTIMATE_READY_REVIEW_STATE).toBe("READY_FOR_REVIEW");
  });

  it("builds a stable idempotency key from quote id", () => {
    expect(buildEstimateReadyIdempotencyKey("quote-123")).toBe("estimate-ready:quote-123");
  });

  it("exposes advisory-team trigger source for the authoritative flow", () => {
    expect(ESTIMATE_READY_TRIGGER_SOURCE.ADVISORY_TEAM_MARK_READY_FOR_REVIEW).toBe(
      "advisory-team-mark-ready-for-review"
    );
  });
});
