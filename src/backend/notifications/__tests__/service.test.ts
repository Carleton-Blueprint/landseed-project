import {
  NotificationDeliveryStatus,
  NotificationEventType,
  AccountDeletionNoticeStatus,
  CommunicationStatus,
} from "@prisma/client";
import { prisma } from "lib/prisma";
import {
  getNotificationDeliveryMetrics,
  queueNotification,
  processNotification,
  NotificationJobPayload,
} from "@/backend/notifications/service";
import { renderEmailTemplate } from "@/backend/notifications/emailTemplates";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logCommunication } from "@/backend/services/communicationHistoryLogger";
import {
  getCategoryFromEventType,
  generateContentSummary,
  getLinkedResourceType,
} from "@/backend/services/communicationHistoryIntegration";

jest.mock("lib/prisma", () => ({
  prisma: {
    notificationDelivery: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    accountDeletionNotice: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    accountDeletionRequest: {
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("@/backend/notifications/emailTemplates", () => ({
  renderEmailTemplate: jest.fn(),
}));

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

jest.mock("@/backend/services/communicationHistoryLogger", () => ({
  logCommunication: jest.fn(),
}));

jest.mock("@/backend/services/communicationHistoryIntegration", () => ({
  getCategoryFromEventType: jest.fn(),
  generateContentSummary: jest.fn(),
  getLinkedResourceType: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  notificationDelivery: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
  };
  accountDeletionNotice: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  accountDeletionRequest: {
    updateMany: jest.Mock;
  };
};

const mockedRenderEmailTemplate = renderEmailTemplate as jest.MockedFunction<
  typeof renderEmailTemplate
>;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<
  typeof sendTransactionalEmail
>;
const mockedLogCommunication = logCommunication as jest.MockedFunction<typeof logCommunication>;
const mockedGetCategoryFromEventType = getCategoryFromEventType as jest.MockedFunction<
  typeof getCategoryFromEventType
>;
const mockedGenerateContentSummary = generateContentSummary as jest.MockedFunction<
  typeof generateContentSummary
>;
const mockedGetLinkedResourceType = getLinkedResourceType as jest.MockedFunction<
  typeof getLinkedResourceType
>;

const DEFAULT_TEMPLATE = {
  templateName: "template-v1",
  subject: "Default subject",
  html: "<p>Default html</p>",
  text: "Default text",
};

function basePayload(overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload {
  return {
    eventType: NotificationEventType.SUBMISSION_RECEIPT,
    idempotencyKey: "idem-1",
    recipientEmail: "client@example.com",
    ...overrides,
  };
}

describe("notifications/service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRenderEmailTemplate.mockReturnValue(DEFAULT_TEMPLATE);
    mockedGetCategoryFromEventType.mockReturnValue("OTHER" as never);
    mockedGenerateContentSummary.mockReturnValue("summary");
    mockedGetLinkedResourceType.mockReturnValue(undefined);
  });

  describe("getNotificationDeliveryMetrics", () => {
    function mockCountsAndFailures() {
      mockedPrisma.notificationDelivery.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(5) // sent
        .mockResolvedValueOnce(2); // failed
      mockedPrisma.notificationDelivery.findMany.mockResolvedValueOnce([
        {
          idempotencyKey: "idem-failed-1",
          recipientEmail: "fail@example.com",
          eventType: NotificationEventType.SUBMISSION_RECEIPT,
          lastError: "boom",
          attempts: 3,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]);
    }

    it("returns the aggregated shape with no optional filters applied", async () => {
      mockCountsAndFailures();

      const result = await getNotificationDeliveryMetrics();

      expect(result).toEqual({
        eventType: undefined,
        projectId: undefined,
        since: undefined,
        totalDeliveries: 10,
        pendingDeliveries: 3,
        sentDeliveries: 5,
        failedDeliveries: 2,
        recentFailures: [
          {
            idempotencyKey: "idem-failed-1",
            recipientEmail: "fail@example.com",
            eventType: NotificationEventType.SUBMISSION_RECEIPT,
            lastError: "boom",
            attempts: 3,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      });

      // No optional filters were supplied, so where clauses should only carry status.
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(1, {
        where: {},
      });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(2, {
        where: { status: NotificationDeliveryStatus.PENDING },
      });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(3, {
        where: { status: NotificationDeliveryStatus.SENT },
      });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(4, {
        where: { status: NotificationDeliveryStatus.FAILED },
      });
      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: NotificationDeliveryStatus.FAILED },
          take: 25,
        })
      );
    });

    it("filters by eventType only when just eventType is supplied", async () => {
      mockCountsAndFailures();

      await getNotificationDeliveryMetrics({ eventType: NotificationEventType.ESTIMATE_READY });

      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(1, {
        where: { eventType: NotificationEventType.ESTIMATE_READY },
      });
      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventType: NotificationEventType.ESTIMATE_READY,
            status: NotificationDeliveryStatus.FAILED,
          },
        })
      );
    });

    it("filters by projectId only when just projectId is supplied", async () => {
      mockCountsAndFailures();

      await getNotificationDeliveryMetrics({ projectId: "project-1" });

      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(1, {
        where: { projectId: "project-1" },
      });
    });

    it("filters by since only when just since is supplied", async () => {
      mockCountsAndFailures();
      const since = new Date("2026-01-01T00:00:00.000Z");

      await getNotificationDeliveryMetrics({ since });

      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(1, {
        where: { createdAt: { gte: since } },
      });
    });

    it("combines all optional filters when all are supplied", async () => {
      mockCountsAndFailures();
      const since = new Date("2026-01-01T00:00:00.000Z");

      const result = await getNotificationDeliveryMetrics({
        eventType: NotificationEventType.ESTIMATE_READY,
        projectId: "project-1",
        since,
      });

      const expectedWhereBase = {
        eventType: NotificationEventType.ESTIMATE_READY,
        projectId: "project-1",
        createdAt: { gte: since },
      };
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(1, {
        where: expectedWhereBase,
      });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenNthCalledWith(2, {
        where: { ...expectedWhereBase, status: NotificationDeliveryStatus.PENDING },
      });
      expect(result.eventType).toBe(NotificationEventType.ESTIMATE_READY);
      expect(result.projectId).toBe("project-1");
      expect(result.since).toBe(since);
    });

    it("uses a custom failedLimit for the recentFailures take clause", async () => {
      mockCountsAndFailures();

      await getNotificationDeliveryMetrics({ failedLimit: 5 });

      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });
  });

  describe("queueNotification", () => {
    it("no-ops without upserting when an existing delivery is already SENT", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: "delivery-1",
        status: NotificationDeliveryStatus.SENT,
      });

      await queueNotification(basePayload());

      expect(mockedPrisma.notificationDelivery.upsert).not.toHaveBeenCalled();
      expect(mockedRenderEmailTemplate).not.toHaveBeenCalled();
    });

    it("upserts with PENDING status when no existing delivery is found (create path)", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue(null);

      const payload = basePayload({
        idempotencyKey: "idem-create",
        recipientEmail: "new@example.com",
        userId: "user-1",
        projectId: "project-1",
      });

      await queueNotification(payload);

      expect(mockedPrisma.notificationDelivery.upsert).toHaveBeenCalledTimes(1);
      const call = mockedPrisma.notificationDelivery.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ idempotencyKey: "idem-create" });
      expect(call.create).toEqual(
        expect.objectContaining({
          eventType: payload.eventType,
          recipientEmail: "new@example.com",
          subject: DEFAULT_TEMPLATE.subject,
          templateName: DEFAULT_TEMPLATE.templateName,
          status: NotificationDeliveryStatus.PENDING,
          idempotencyKey: "idem-create",
          userId: "user-1",
          projectId: "project-1",
        })
      );
    });

    it("upserts with PENDING status and resets lastError when an existing non-SENT delivery is found (update path)", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: "delivery-2",
        status: NotificationDeliveryStatus.FAILED,
      });

      const payload = basePayload({ idempotencyKey: "idem-update" });

      await queueNotification(payload);

      expect(mockedPrisma.notificationDelivery.upsert).toHaveBeenCalledTimes(1);
      const call = mockedPrisma.notificationDelivery.upsert.mock.calls[0][0];
      expect(call.update).toEqual(
        expect.objectContaining({
          status: NotificationDeliveryStatus.PENDING,
          lastError: null,
        })
      );
    });

    it("strips undefined keys from the payload before storing it as JSON", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue(null);

      const payload = basePayload({ userId: undefined, projectId: undefined });

      await queueNotification(payload);

      const call = mockedPrisma.notificationDelivery.upsert.mock.calls[0][0];
      expect(call.create.payload).not.toHaveProperty("userId");
      expect(call.create.payload).not.toHaveProperty("projectId");
    });
  });

  describe("processNotification", () => {
    beforeEach(() => {
      mockedSendTransactionalEmail.mockResolvedValue({
        provider: "test-provider",
        messageId: "msg-1",
      });
    });

    it("throws when no NotificationDelivery row exists for the idempotencyKey", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue(null);

      await expect(processNotification(basePayload())).rejects.toThrow(
        "Notification delivery record not found for idem-1"
      );
      expect(mockedPrisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
    });

    it("no-ops without sending email when the claim updateMany matches zero rows (race guard)", async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: "delivery-1",
        status: NotificationDeliveryStatus.SENT,
        attempts: 1,
      });
      mockedPrisma.notificationDelivery.updateMany.mockResolvedValue({ count: 0 });

      await processNotification(basePayload());

      expect(mockedPrisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
        where: {
          idempotencyKey: "idem-1",
          status: { in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED] },
        },
        data: { status: NotificationDeliveryStatus.PROCESSING },
      });
      expect(mockedSendTransactionalEmail).not.toHaveBeenCalled();
      expect(mockedPrisma.notificationDelivery.update).not.toHaveBeenCalled();
    });

    describe("success path", () => {
      beforeEach(() => {
        mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
          id: "delivery-1",
          status: NotificationDeliveryStatus.PENDING,
          attempts: 0,
        });
        mockedPrisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
      });

      it("sends the email and marks the delivery SENT", async () => {
        await processNotification(basePayload());

        expect(mockedSendTransactionalEmail).toHaveBeenCalledWith({
          to: "client@example.com",
          subject: DEFAULT_TEMPLATE.subject,
          html: DEFAULT_TEMPLATE.html,
          text: DEFAULT_TEMPLATE.text,
        });

        expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
          where: { id: "delivery-1" },
          data: expect.objectContaining({
            status: NotificationDeliveryStatus.SENT,
            provider: "test-provider",
            providerMessageId: "msg-1",
            lastError: null,
          }),
        });
      });

      it("uses payload subject/html/text overrides when provided instead of the template", async () => {
        await processNotification(
          basePayload({
            subject: "override subject",
            html: "<p>override</p>",
            text: "override text",
          })
        );

        expect(mockedSendTransactionalEmail).toHaveBeenCalledWith({
          to: "client@example.com",
          subject: "override subject",
          html: "<p>override</p>",
          text: "override text",
        });
      });

      it("does not touch accountDeletionNotice when payload.noticeId is not set", async () => {
        await processNotification(basePayload());

        expect(mockedPrisma.accountDeletionNotice.findUnique).not.toHaveBeenCalled();
        expect(mockedPrisma.accountDeletionNotice.update).not.toHaveBeenCalled();
        expect(mockedPrisma.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
      });

      it("does not log communication history when payload.projectId is not set", async () => {
        await processNotification(basePayload());

        expect(mockedLogCommunication).not.toHaveBeenCalled();
      });

      it("marks the linked notice SENT and transitions the request to IN_GRACE_PERIOD for ADVANCE_NOTICE", async () => {
        mockedPrisma.accountDeletionNotice.findUnique.mockResolvedValue({
          id: "notice-1",
          noticeType: "ADVANCE_NOTICE",
          accountDeletionRequestId: "request-1",
        });

        await processNotification(basePayload({ noticeId: "notice-1" }));

        expect(mockedPrisma.accountDeletionNotice.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "notice-1" },
            data: expect.objectContaining({
              status: AccountDeletionNoticeStatus.SENT,
              lastError: null,
            }),
          })
        );
        expect(mockedPrisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith({
          where: { id: "request-1", status: "REQUESTED" },
          data: { status: "IN_GRACE_PERIOD" },
        });
      });

      it("marks the linked notice SENT and transitions the request to READY_FOR_DELETION for FINAL_NOTICE", async () => {
        mockedPrisma.accountDeletionNotice.findUnique.mockResolvedValue({
          id: "notice-2",
          noticeType: "FINAL_NOTICE",
          accountDeletionRequestId: "request-2",
        });

        await processNotification(basePayload({ noticeId: "notice-2" }));

        expect(mockedPrisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith({
          where: { id: "request-2", status: "IN_GRACE_PERIOD" },
          data: { status: "READY_FOR_DELETION" },
        });
      });

      it("skips notice/request transitions entirely when the notice is not found", async () => {
        mockedPrisma.accountDeletionNotice.findUnique.mockResolvedValue(null);

        await processNotification(basePayload({ noticeId: "missing-notice" }));

        expect(mockedPrisma.accountDeletionNotice.update).not.toHaveBeenCalled();
        expect(mockedPrisma.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
      });

      it("logs SENT communication history when payload.projectId is set", async () => {
        mockedGetCategoryFromEventType.mockReturnValue("SUBMISSION_RECEIPT" as never);
        mockedGetLinkedResourceType.mockReturnValue("Quote");
        mockedGenerateContentSummary.mockReturnValue("content summary");

        await processNotification(
          basePayload({
            projectId: "project-1",
            userId: "user-1",
            senderId: "sender-1",
            linkedResourceId: "resource-1",
          })
        );

        expect(mockedLogCommunication).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            communicationType: "EMAIL",
            category: "SUBMISSION_RECEIPT",
            recipientEmail: "client@example.com",
            recipientId: "user-1",
            senderId: "sender-1",
            subject: DEFAULT_TEMPLATE.subject,
            contentSummary: "content summary",
            linkedResourceType: "Quote",
            linkedResourceId: "resource-1",
            status: CommunicationStatus.SENT,
          })
        );
      });
    });

    describe("failure path", () => {
      beforeEach(() => {
        mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
          id: "delivery-1",
          status: NotificationDeliveryStatus.PENDING,
          attempts: 0,
        });
        mockedPrisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
        mockedSendTransactionalEmail.mockRejectedValue(new Error("send failed"));
      });

      it("marks the delivery FAILED with lastError and re-throws the original error", async () => {
        await expect(processNotification(basePayload())).rejects.toThrow("send failed");

        expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
          where: { id: "delivery-1" },
          data: expect.objectContaining({
            status: NotificationDeliveryStatus.FAILED,
            lastError: "send failed",
          }),
        });
      });

      it("marks a linked notice FAILED when noticeId is set", async () => {
        await expect(
          processNotification(basePayload({ noticeId: "notice-1" }))
        ).rejects.toThrow("send failed");

        expect(mockedPrisma.accountDeletionNotice.update).toHaveBeenCalledWith({
          where: { id: "notice-1" },
          data: expect.objectContaining({
            status: AccountDeletionNoticeStatus.FAILED,
            lastError: "send failed",
          }),
        });
      });

      it("still re-throws the original send error when updating the linked notice also fails", async () => {
        mockedPrisma.accountDeletionNotice.update.mockRejectedValue(
          new Error("notice update failed")
        );

        await expect(
          processNotification(basePayload({ noticeId: "notice-1" }))
        ).rejects.toThrow("send failed");
      });

      it("logs a FAILED communication history entry when projectId is set", async () => {
        await expect(
          processNotification(basePayload({ projectId: "project-1" }))
        ).rejects.toThrow("send failed");

        expect(mockedLogCommunication).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            status: CommunicationStatus.FAILED,
            metadata: expect.objectContaining({
              error: "send failed",
            }),
          })
        );
      });

      it("still re-throws the original send error when logging communication history also fails", async () => {
        mockedLogCommunication.mockRejectedValue(new Error("logging failed"));

        await expect(
          processNotification(basePayload({ projectId: "project-1" }))
        ).rejects.toThrow("send failed");
      });

      it("re-throws even when both the notice update and communication logging also fail", async () => {
        mockedPrisma.accountDeletionNotice.update.mockRejectedValue(
          new Error("notice update failed")
        );
        mockedLogCommunication.mockRejectedValue(new Error("logging failed"));

        await expect(
          processNotification(
            basePayload({ noticeId: "notice-1", projectId: "project-1" })
          )
        ).rejects.toThrow("send failed");
      });

      it("uses a fallback lastError message when the thrown value is not an Error instance", async () => {
        mockedSendTransactionalEmail.mockRejectedValue("plain string failure");

        await expect(processNotification(basePayload())).rejects.toBe("plain string failure");

        expect(mockedPrisma.notificationDelivery.update).toHaveBeenCalledWith({
          where: { id: "delivery-1" },
          data: expect.objectContaining({
            lastError: "Unknown email send error",
          }),
        });
      });
    });
  });
});
