import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import {
  buildManualReviewNotificationIdempotencyKey,
  enqueueManualReviewFlagNotification,
} from "@/backend/notifications/manualReviewNotificationContract";

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

describe("manualReviewNotificationContract", () => {
  const mockedEnqueue = enqueueNotification as jest.MockedFunction<typeof enqueueNotification>;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  describe("buildManualReviewNotificationIdempotencyKey", () => {
    it("builds a stable idempotency key from flag id", () => {
      expect(buildManualReviewNotificationIdempotencyKey("flag-1")).toBe(
        "manual-review-flag-created:flag-1"
      );
    });
  });

  describe("enqueueManualReviewFlagNotification", () => {
    const basePayload = {
      projectId: "project-1",
      projectAddress: "10 Main St",
      flagId: "flag-1",
      reason: "HIGH_COMPLEXITY",
      description: "Project complexity is HIGH (3 signals detected)",
    };

    it("does not enqueue anything when there are no admin emails", async () => {
      await enqueueManualReviewFlagNotification({
        ...basePayload,
        adminEmails: [],
      });

      expect(mockedEnqueue).not.toHaveBeenCalled();
    });

    it("enqueues a single notification for one admin email", async () => {
      await enqueueManualReviewFlagNotification({
        ...basePayload,
        adminEmails: ["admin1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledTimes(1);
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: NotificationEventType.MANUAL_REVIEW_FLAG_CREATED,
          idempotencyKey: "manual-review-flag-created:flag-1:admin1@example.com",
          recipientEmail: "admin1@example.com",
          recipientName: "Admin",
          projectId: "project-1",
          projectAddress: "10 Main St",
          estimateLink: "http://localhost:3000/admin/flagged-projects",
          manualReviewReason: "HIGH_COMPLEXITY",
          manualReviewDescription: "Project complexity is HIGH (3 signals detected)",
        })
      );
    });

    it("enqueues one notification per admin email with per-email idempotency keys", async () => {
      await enqueueManualReviewFlagNotification({
        ...basePayload,
        adminEmails: ["admin1@example.com", "admin2@example.com", "admin3@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledTimes(3);

      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          recipientEmail: "admin1@example.com",
          idempotencyKey: "manual-review-flag-created:flag-1:admin1@example.com",
        })
      );
      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          recipientEmail: "admin2@example.com",
          idempotencyKey: "manual-review-flag-created:flag-1:admin2@example.com",
        })
      );
      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          recipientEmail: "admin3@example.com",
          idempotencyKey: "manual-review-flag-created:flag-1:admin3@example.com",
        })
      );
    });

    it("uses APP_BASE_URL for the flagged-projects link when set", async () => {
      process.env.APP_BASE_URL = "https://app.landseed.test";

      await enqueueManualReviewFlagNotification({
        ...basePayload,
        adminEmails: ["admin1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://app.landseed.test/admin/flagged-projects",
        })
      );
    });

    it("falls back to NEXTAUTH_URL for the flagged-projects link when APP_BASE_URL is unset", async () => {
      process.env.NEXTAUTH_URL = "https://nextauth.landseed.test";

      await enqueueManualReviewFlagNotification({
        ...basePayload,
        adminEmails: ["admin1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://nextauth.landseed.test/admin/flagged-projects",
        })
      );
    });
  });
});
