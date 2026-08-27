import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { queueNotification } from "@/backend/notifications/service";
import { emailQueue } from "@/backend/queue";
import type { NotificationJobPayload } from "@/backend/notifications/service";

jest.mock("@/backend/notifications/service", () => ({
  queueNotification: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  emailQueue: { add: jest.fn() },
}));

describe("enqueueNotification", () => {
  const mockedQueueNotification = queueNotification as jest.MockedFunction<typeof queueNotification>;
  const mockedEmailQueueAdd = emailQueue.add as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function basePayload(overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload {
    return {
      eventType: NotificationEventType.SUBMISSION_RECEIPT,
      idempotencyKey: "idem-1",
      recipientEmail: "client@example.com",
      ...overrides,
    };
  }

  it("calls queueNotification before adding the job to the email queue", async () => {
    const callOrder: string[] = [];
    mockedQueueNotification.mockImplementation(async () => {
      callOrder.push("queueNotification");
    });
    mockedEmailQueueAdd.mockImplementation(async () => {
      callOrder.push("emailQueue.add");
      return {};
    });

    await enqueueNotification(basePayload());

    expect(callOrder).toEqual(["queueNotification", "emailQueue.add"]);
  });

  it("adds a job named notify-<idempotencyKey> with removeOnComplete/removeOnFail options", async () => {
    await enqueueNotification(basePayload({ idempotencyKey: "idem-abc" }));

    expect(mockedEmailQueueAdd).toHaveBeenCalledTimes(1);
    const [jobName, , opts] = mockedEmailQueueAdd.mock.calls[0];
    expect(jobName).toBe("notify-idem-abc");
    expect(opts).toEqual(
      expect.objectContaining({
        removeOnComplete: 100,
        removeOnFail: 500,
      })
    );
  });

  describe("priority assignment", () => {
    it.each([
      NotificationEventType.ESTIMATE_READY,
      NotificationEventType.ESTIMATE_UPDATED,
      NotificationEventType.ESTIMATE_EXPIRED,
      NotificationEventType.ESTIMATE_REACTIVATED,
    ])("assigns priority 1 for estimate-lifecycle event %s", async (eventType) => {
      await enqueueNotification(basePayload({ eventType }));

      const [, , opts] = mockedEmailQueueAdd.mock.calls[0];
      expect(opts).toEqual(expect.objectContaining({ priority: 1 }));
    });

    it.each([
      NotificationEventType.EMAIL_VERIFICATION,
      NotificationEventType.PASSWORD_RESET,
      NotificationEventType.EMAIL_CHANGE_VERIFY_OLD,
      NotificationEventType.EMAIL_CHANGE_VERIFY_NEW,
    ])("assigns priority 1 for auth event %s", async (eventType) => {
      await enqueueNotification(basePayload({ eventType }));

      const [, , opts] = mockedEmailQueueAdd.mock.calls[0];
      expect(opts).toEqual(expect.objectContaining({ priority: 1 }));
    });

    it.each([
      NotificationEventType.SUBMISSION_RECEIPT,
      NotificationEventType.MANUAL_FALLBACK_EXPORT_READY,
      NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM,
      NotificationEventType.FILE_MALWARE_DETECTED,
      NotificationEventType.INFORMATION_REQUEST_CREATED,
    ])("defaults to priority 2 for non estimate-lifecycle, non-auth event %s", async (eventType) => {
      await enqueueNotification(basePayload({ eventType }));

      const [, , opts] = mockedEmailQueueAdd.mock.calls[0];
      expect(opts).toEqual(expect.objectContaining({ priority: 2 }));
    });
  });

  it("maps the full payload shape onto the queued job data", async () => {
    const payload = basePayload({
      eventType: NotificationEventType.ESTIMATE_READY,
      idempotencyKey: "idem-full",
      recipientEmail: "client@example.com",
      recipientName: "Client A",
      userId: "user-1",
      projectId: "project-1",
      projectAddress: "10 Main St",
      estimateLink: "https://example.com/estimate",
      estimateMin: 100,
      estimateMax: 200,
      subject: "custom subject",
      html: "<p>hi</p>",
      text: "hi",
      noticeId: "notice-1",
      accountDeletionRequestId: "req-1",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      authActionLink: "https://example.com/auth",
      seniorName: "Senior A",
      isCaregiverSubmission: true,
      senderId: "sender-1",
      linkedResourceId: "resource-1",
      informationRequestType: "PHOTOS",
      informationRequestMessage: "please upload",
      newEmail: "new@example.com",
    });

    await enqueueNotification(payload);

    const [, jobData] = mockedEmailQueueAdd.mock.calls[0];
    expect(jobData).toEqual({
      eventType: payload.eventType,
      idempotencyKey: "idem-full",
      recipientEmail: "client@example.com",
      recipientName: "Client A",
      userId: "user-1",
      projectId: "project-1",
      projectAddress: "10 Main St",
      estimateLink: "https://example.com/estimate",
      estimateMin: 100,
      estimateMax: 200,
      subject: "custom subject",
      html: "<p>hi</p>",
      text: "hi",
      noticeId: "notice-1",
      accountDeletionRequestId: "req-1",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      authActionLink: "https://example.com/auth",
      seniorName: "Senior A",
      isCaregiverSubmission: true,
      senderId: "sender-1",
      linkedResourceId: "resource-1",
      informationRequestType: "PHOTOS",
      informationRequestMessage: "please upload",
      newEmail: "new@example.com",
    });
  });

  it("maps previousTotal/newTotal onto the queued job data for ESTIMATE_UPDATED", async () => {
    await enqueueNotification(
      basePayload({
        eventType: NotificationEventType.ESTIMATE_UPDATED,
        previousTotal: 1200,
        newTotal: 1450,
      })
    );

    const [, jobData] = mockedEmailQueueAdd.mock.calls[0];
    expect(jobData).toEqual(
      expect.objectContaining({
        eventType: NotificationEventType.ESTIMATE_UPDATED,
        previousTotal: 1200,
        newTotal: 1450,
      })
    );
  });

  it("propagates a rejection from queueNotification without adding to the email queue", async () => {
    mockedQueueNotification.mockRejectedValueOnce(new Error("db down"));

    await expect(enqueueNotification(basePayload())).rejects.toThrow("db down");
    expect(mockedEmailQueueAdd).not.toHaveBeenCalled();
  });
});
