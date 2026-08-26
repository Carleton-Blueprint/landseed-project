import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import {
  buildInformationRequestNotificationIdempotencyKey,
  enqueueInformationRequestNotificationForClient,
} from "@/backend/notifications/informationRequestNotificationContract";

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

describe("informationRequestNotificationContract", () => {
  const mockedEnqueue = enqueueNotification as jest.MockedFunction<typeof enqueueNotification>;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.NEXTAUTH_URL;
  });

  describe("buildInformationRequestNotificationIdempotencyKey", () => {
    it("builds a stable idempotency key from the information request id", () => {
      expect(buildInformationRequestNotificationIdempotencyKey("info-req-1")).toBe(
        "information-request-created:info-req-1"
      );
    });
  });

  describe("enqueueInformationRequestNotificationForClient", () => {
    const basePayload = {
      informationRequestId: "info-req-1",
      projectId: "project-1",
      projectAddress: "10 Main St",
      requestType: "PHOTOS",
      message: "Please upload photos of the bathroom entrance.",
      requestedByUserId: "staff-1",
      clientUserId: "client-1",
      clientEmail: "client@example.com",
      clientName: "Client A",
    };

    it("builds and enqueues a single notification with the correct payload mapping", async () => {
      await enqueueInformationRequestNotificationForClient(basePayload);

      expect(mockedEnqueue).toHaveBeenCalledTimes(1);
      expect(mockedEnqueue).toHaveBeenCalledWith({
        eventType: NotificationEventType.INFORMATION_REQUEST_CREATED,
        idempotencyKey: "information-request-created:info-req-1",
        recipientEmail: "client@example.com",
        recipientName: "Client A",
        userId: "client-1",
        projectId: "project-1",
        projectAddress: "10 Main St",
        estimateLink: "http://localhost:3000/dashboard/project-1",
        senderId: "staff-1",
        linkedResourceId: "info-req-1",
        informationRequestType: "PHOTOS",
        informationRequestMessage: "Please upload photos of the bathroom entrance.",
      });
    });

    it("maps senderId from requestedByUserId and linkedResourceId from informationRequestId", async () => {
      await enqueueInformationRequestNotificationForClient(basePayload);

      const [callArg] = mockedEnqueue.mock.calls[0];
      expect(callArg.senderId).toBe(basePayload.requestedByUserId);
      expect(callArg.linkedResourceId).toBe(basePayload.informationRequestId);
    });

    it("maps informationRequestType and informationRequestMessage from requestType/message", async () => {
      await enqueueInformationRequestNotificationForClient({
        ...basePayload,
        requestType: "DOCUMENTS",
        message: "Please upload proof of income.",
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          informationRequestType: "DOCUMENTS",
          informationRequestMessage: "Please upload proof of income.",
        })
      );
    });

    it("handles a null clientName by passing it through as recipientName", async () => {
      await enqueueInformationRequestNotificationForClient({
        ...basePayload,
        clientName: null,
      });

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientName: null,
        })
      );
    });

    it("builds the dashboard link from APP_BASE_URL and the projectId", async () => {
      process.env.APP_BASE_URL = "https://app.landseed.test";

      await enqueueInformationRequestNotificationForClient(basePayload);

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://app.landseed.test/dashboard/project-1",
        })
      );
    });

    it("falls back to NEXTAUTH_URL for the dashboard link when APP_BASE_URL is unset", async () => {
      process.env.NEXTAUTH_URL = "https://nextauth.landseed.test";

      await enqueueInformationRequestNotificationForClient(basePayload);

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          estimateLink: "https://nextauth.landseed.test/dashboard/project-1",
        })
      );
    });
  });
});
