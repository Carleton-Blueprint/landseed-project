import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("@/backend/features/flags", () => ({
  FeatureFlag: { MANUAL_REVIEW_AUTO_FLAG: "MANUAL_REVIEW_AUTO_FLAG" },
  isFeatureFlagEnabled: jest.fn(),
}));

jest.mock("@/backend/eligibility/manualReviewClassifier", () => ({
  classifyManualReviewNeed: jest.fn(),
}));

const mockManualReviewQueueAdd = jest.fn();
jest.mock("@/backend/queue", () => ({
  manualReviewQueue: { add: (...args: unknown[]) => mockManualReviewQueueAdd(...args) },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { isFeatureFlagEnabled } = require("@/backend/features/flags") as {
  isFeatureFlagEnabled: jest.Mock;
};
const { classifyManualReviewNeed } = require("@/backend/eligibility/manualReviewClassifier") as {
  classifyManualReviewNeed: jest.Mock;
};

const { produceManualReviewFlagJob } = require("../manualReviewProducer") as {
  produceManualReviewFlagJob: (
    projectId: string,
    assessmentId: string,
    input: unknown,
    discoveredGrants: Array<{ confidence: "HIGH" | "MEDIUM" | "LOW" }>,
    discoveryMetadata: { candidateCount?: number }
  ) => Promise<boolean>;
};

function grant(confidence: "HIGH" | "MEDIUM" | "LOW") {
  return { confidence } as any;
}

describe("produceManualReviewFlagJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManualReviewQueueAdd.mockResolvedValue(undefined);
  });

  it("returns false immediately without classifying or enqueueing when the feature flag is disabled", async () => {
    isFeatureFlagEnabled.mockReturnValue(false);

    const result = await produceManualReviewFlagJob(
      "project-1",
      "assessment-1",
      {} as any,
      [grant("HIGH")],
      { candidateCount: 5 }
    );

    expect(result).toBe(false);
    expect(classifyManualReviewNeed).not.toHaveBeenCalled();
    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  describe("when the feature flag is enabled", () => {
    beforeEach(() => {
      isFeatureFlagEnabled.mockReturnValue(true);
    });

    it("returns false and does not enqueue when classification says shouldFlag is false", async () => {
      classifyManualReviewNeed.mockReturnValue({ shouldFlag: false, complexityScore: 0 });

      const result = await produceManualReviewFlagJob(
        "project-2",
        "assessment-2",
        {} as any,
        [grant("HIGH")],
        { candidateCount: 5 }
      );

      expect(result).toBe(false);
      expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    });

    it("enqueues with the idempotent jobId and returns true when classification says shouldFlag is true", async () => {
      classifyManualReviewNeed.mockReturnValue({
        shouldFlag: true,
        complexityScore: 3,
        reason: "HIGH_COMPLEXITY",
      });

      const input = { some: "input" } as any;
      const result = await produceManualReviewFlagJob(
        "project-3",
        "assessment-3",
        input,
        [grant("HIGH")],
        { candidateCount: 10 }
      );

      expect(result).toBe(true);
      expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
      const [name, data, opts] = mockManualReviewQueueAdd.mock.calls[0] as [
        string,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(name).toBe("manual-review-flag");
      expect(data).toEqual({
        projectId: "project-3",
        assessmentId: "assessment-3",
        aiConfidence: "HIGH",
        complexityScore: 3,
        reason: "HIGH_COMPLEXITY",
      });
      expect(opts).toEqual({
        jobId: "manual-review-project-3-assessment-3",
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      });
    });

    it("passes classifyManualReviewNeed the derived confidence and grant/candidate counts", async () => {
      classifyManualReviewNeed.mockReturnValue({ shouldFlag: false });

      const input = { some: "input" } as any;
      await produceManualReviewFlagJob(
        "project-4",
        "assessment-4",
        input,
        [grant("LOW"), grant("LOW")],
        { candidateCount: 8 }
      );

      expect(classifyManualReviewNeed).toHaveBeenCalledWith(input, "LOW", 2, 8);
    });

    it("defaults totalCandidatesCount to 0 when discoveryMetadata.candidateCount is missing", async () => {
      classifyManualReviewNeed.mockReturnValue({ shouldFlag: false });

      await produceManualReviewFlagJob("project-5", "assessment-5", {} as any, [], {});

      expect(classifyManualReviewNeed).toHaveBeenCalledWith({}, "MEDIUM", 0, 0);
    });

    describe("deriveOverallAiConfidence (via aiConfidence in the enqueued payload)", () => {
      beforeEach(() => {
        classifyManualReviewNeed.mockReturnValue({ shouldFlag: true, complexityScore: 1 });
      });

      it("defaults to MEDIUM when there are no discovered grants", async () => {
        await produceManualReviewFlagJob("p", "a", {} as any, [], {});
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("MEDIUM");
      });

      it("picks the outright majority level", async () => {
        await produceManualReviewFlagJob(
          "p",
          "a",
          {} as any,
          [grant("HIGH"), grant("HIGH"), grant("MEDIUM")],
          {}
        );
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("HIGH");
      });

      it("breaks a HIGH/MEDIUM tie in favor of HIGH", async () => {
        await produceManualReviewFlagJob(
          "p",
          "a",
          {} as any,
          [grant("HIGH"), grant("MEDIUM")],
          {}
        );
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("HIGH");
      });

      it("breaks a MEDIUM/LOW tie in favor of MEDIUM", async () => {
        await produceManualReviewFlagJob(
          "p",
          "a",
          {} as any,
          [grant("MEDIUM"), grant("LOW")],
          {}
        );
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("MEDIUM");
      });

      it("breaks a three-way HIGH/MEDIUM/LOW tie in favor of HIGH", async () => {
        await produceManualReviewFlagJob(
          "p",
          "a",
          {} as any,
          [grant("HIGH"), grant("MEDIUM"), grant("LOW")],
          {}
        );
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("HIGH");
      });

      it("picks LOW when LOW is the outright majority", async () => {
        await produceManualReviewFlagJob(
          "p",
          "a",
          {} as any,
          [grant("LOW"), grant("LOW"), grant("MEDIUM")],
          {}
        );
        const data = mockManualReviewQueueAdd.mock.calls[0][1] as Record<string, unknown>;
        expect(data.aiConfidence).toBe("LOW");
      });
    });
  });
});
