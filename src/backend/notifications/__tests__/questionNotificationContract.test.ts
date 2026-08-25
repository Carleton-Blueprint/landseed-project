import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import {
  buildQuestionNotificationIdempotencyKey,
  enqueueQuestionNotificationForAdvisoryTeam,
} from "@/backend/notifications/questionNotificationContract";

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

describe("questionNotificationContract", () => {
  const mockedEnqueue = enqueueNotification as jest.MockedFunction<typeof enqueueNotification>;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  describe("buildQuestionNotificationIdempotencyKey", () => {
    it("builds a stable idempotency key from question id", () => {
      expect(buildQuestionNotificationIdempotencyKey("question-1")).toBe(
        "question-submitted:question-1"
      );
    });
  });

  describe("enqueueQuestionNotificationForAdvisoryTeam", () => {
    const basePayload = {
      quoteId: "quote-1",
      projectId: "project-1",
      projectAddress: "10 Main St",
      questionCategory: "PRICING",
      questionSubject: "How much for a ramp?",
      questionId: "question-1",
      clientName: "Client A",
      clientEmail: "client@example.com",
    };

    it("does not enqueue anything when there are no advisory team emails", async () => {
      await enqueueQuestionNotificationForAdvisoryTeam({
        ...basePayload,
        advisoryTeamEmails: [],
      });

      expect(mockedEnqueue).not.toHaveBeenCalled();
    });

    it("enqueues a single notification for one advisory team email", async () => {
      await enqueueQuestionNotificationForAdvisoryTeam({
        ...basePayload,
        advisoryTeamEmails: ["advisor1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledTimes(1);
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM,
          idempotencyKey: "question-submitted:question-1:advisor1@example.com",
          recipientEmail: "advisor1@example.com",
          recipientName: "Advisory Team Member",
          projectId: "project-1",
          projectAddress: "10 Main St",
          estimateLink: "http://localhost:3000/admin",
          questionCategory: "PRICING",
          questionSubject: "How much for a ramp?",
        })
      );
    });

    it("enqueues one notification per advisory team email with per-email idempotency keys", async () => {
      await enqueueQuestionNotificationForAdvisoryTeam({
        ...basePayload,
        advisoryTeamEmails: ["advisor1@example.com", "advisor2@example.com", "advisor3@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledTimes(3);

      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          recipientEmail: "advisor1@example.com",
          idempotencyKey: "question-submitted:question-1:advisor1@example.com",
        })
      );
      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          recipientEmail: "advisor2@example.com",
          idempotencyKey: "question-submitted:question-1:advisor2@example.com",
        })
      );
      expect(mockedEnqueue).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          recipientEmail: "advisor3@example.com",
          idempotencyKey: "question-submitted:question-1:advisor3@example.com",
        })
      );
    });

    it("uses APP_BASE_URL for the admin dashboard link when set", async () => {
      process.env.APP_BASE_URL = "https://app.landseed.test";

      await enqueueQuestionNotificationForAdvisoryTeam({
        ...basePayload,
        advisoryTeamEmails: ["advisor1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://app.landseed.test/admin",
        })
      );
    });

    it("falls back to NEXTAUTH_URL for the admin dashboard link when APP_BASE_URL is unset", async () => {
      process.env.NEXTAUTH_URL = "https://nextauth.landseed.test";

      await enqueueQuestionNotificationForAdvisoryTeam({
        ...basePayload,
        advisoryTeamEmails: ["advisor1@example.com"],
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://nextauth.landseed.test/admin",
        })
      );
    });
  });
});
