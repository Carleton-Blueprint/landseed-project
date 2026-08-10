import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const mockManualReviewQueueAdd = jest.fn().mockResolvedValue(undefined);
jest.mock("@/backend/queue", () => ({
  manualReviewQueue: { add: (...args: unknown[]) => mockManualReviewQueueAdd(...args) },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: { photo: { findUnique: jest.Mock } };
};
const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock;
};
const { flagAiJobFailureForManualReview } = require("../aiJobFailureEscalation") as
  typeof import("../aiJobFailureEscalation");

describe("flagAiJobFailureForManualReview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enqueues a manual review flag and logs an audit event when the photo exists", async () => {
    prisma.photo.findUnique.mockResolvedValue({ id: "photo-1", projectId: "project-1" });

    await flagAiJobFailureForManualReview({
      jobType: "ACCESSIBILITY_IMAGE_GENERATION",
      photoId: "photo-1",
      errorMessage: "OpenAI request timed out",
      attemptsMade: 3,
      maxAttempts: 3,
    });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mockManualReviewQueueAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(name).toBe("manual-review");
    expect(data).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        reason: "AI_JOB_RETRIES_EXHAUSTED",
        aiConfidence: "LOW",
        photoId: "photo-1",
        metadata: expect.objectContaining({
          jobType: "ACCESSIBILITY_IMAGE_GENERATION",
          errorMessage: "OpenAI request timed out",
          attemptsMade: 3,
          maxAttempts: 3,
        }),
      })
    );
    expect(opts).toEqual(
      expect.objectContaining({
        jobId: "manual-review-ai-job-failure-ACCESSIBILITY_IMAGE_GENERATION-photo-1",
      })
    );

    expect(logAuditEventNonBlocking).toHaveBeenCalledTimes(1);
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "MANUAL_CHANGE",
        action: "AI_JOB_MANUAL_REVIEW_FLAGGED",
        outcome: "SUCCESS",
        projectId: "project-1",
        resourceType: "ai_job",
        resourceId: "photo-1",
      })
    );
  });

  it("uses a stable, idempotent jobId per (jobType, photoId) pair", async () => {
    prisma.photo.findUnique.mockResolvedValue({ id: "photo-2", projectId: "project-2" });

    await flagAiJobFailureForManualReview({
      jobType: "PHOTO_MODIFICATION_ANALYSIS",
      photoId: "photo-2",
      errorMessage: "vision call failed",
      attemptsMade: 3,
      maxAttempts: 3,
    });
    await flagAiJobFailureForManualReview({
      jobType: "PHOTO_MODIFICATION_ANALYSIS",
      photoId: "photo-2",
      errorMessage: "vision call failed again",
      attemptsMade: 3,
      maxAttempts: 3,
    });

    const jobIds = mockManualReviewQueueAdd.mock.calls.map(
      (call) => (call[2] as Record<string, unknown>).jobId
    );
    expect(jobIds).toEqual([
      "manual-review-ai-job-failure-PHOTO_MODIFICATION_ANALYSIS-photo-2",
      "manual-review-ai-job-failure-PHOTO_MODIFICATION_ANALYSIS-photo-2",
    ]);
  });

  it("no-ops without enqueueing or logging when the photo no longer exists", async () => {
    prisma.photo.findUnique.mockResolvedValue(null);

    await flagAiJobFailureForManualReview({
      jobType: "ACCESSIBILITY_IMAGE_GENERATION",
      photoId: "missing-photo",
      errorMessage: "OpenAI request timed out",
      attemptsMade: 3,
      maxAttempts: 3,
    });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    expect(logAuditEventNonBlocking).not.toHaveBeenCalled();
  });
});
