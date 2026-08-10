/** @jest-environment node */

import { prisma } from "lib/prisma";
import { queueNotification, processNotification } from "@/backend/notifications/service";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { NotificationDeliveryStatus, NotificationEventType } from "@prisma/client";

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(async () => ({ provider: "test", messageId: "msg-1" })),
}));

describe("processNotification claim guard", () => {
  const idempotencyKey = `test-claim-race:${Date.now()}`;

  afterAll(async () => {
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey } });
    await prisma.$disconnect();
  });

  it("does not re-claim a delivery another worker already moved to PROCESSING", async () => {
    const payload = {
      eventType: NotificationEventType.SUBMISSION_RECEIPT,
      idempotencyKey,
      recipientEmail: "test@example.com",
      recipientName: "Test User",
      subject: "Race test",
      html: "<p>Race test</p>",
      text: "Race test",
    };

    await queueNotification(payload);

    // Simulate a concurrent worker that already claimed this delivery.
    await prisma.notificationDelivery.update({
      where: { idempotencyKey },
      data: { status: NotificationDeliveryStatus.PROCESSING },
    });

    const mockSend = sendTransactionalEmail as jest.Mock;
    mockSend.mockClear();

    await processNotification(payload);

    expect(mockSend).not.toHaveBeenCalled();

    const delivery = await prisma.notificationDelivery.findUnique({ where: { idempotencyKey } });
    expect(delivery?.status).toBe(NotificationDeliveryStatus.PROCESSING);
  });
});
