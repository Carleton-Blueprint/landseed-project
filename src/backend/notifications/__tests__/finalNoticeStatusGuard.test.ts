/** @jest-environment node */

import { prisma } from "lib/prisma";
import { queueNotification, processNotification } from "@/backend/notifications/service";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import {
  createAccountDeletionNotice,
  requestAccountDeletion,
  cancelAccountDeletionRequest,
} from "@/backend/services/accountDeletionRetention";
import { AccountDeletionNoticeType, NotificationEventType } from "@prisma/client";

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(async () => ({ provider: "test", messageId: "msg-1" })),
}));

describe("FINAL_NOTICE status guard", () => {
  let userId: string;
  let requestId: string;
  let noticeId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-final-guard-${Date.now()}@example.com`, name: "Test User", phone: "555-555-5555" },
    });
    userId = user.id;

    const req = await requestAccountDeletion({ targetUserId: userId, requestedByUserId: userId });
    requestId = req.id;

    noticeId = await createAccountDeletionNotice({
      requestId,
      noticeType: AccountDeletionNoticeType.FINAL_NOTICE,
    });

    // Request is cancelled before the (stray) final notice is processed.
    await cancelAccountDeletionRequest({ requestId });
  });

  afterAll(async () => {
    await prisma.accountDeletionNotice.deleteMany({ where: { accountDeletionRequestId: requestId } });
    await prisma.accountDeletionRequest.deleteMany({ where: { id: requestId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey: `test-final-guard:${noticeId}` } });
    await prisma.$disconnect();
  });

  it("does not move a CANCELLED request to READY_FOR_DELETION on a stray final notice", async () => {
    const idempotencyKey = `test-final-guard:${noticeId}`;
    const payload = {
      eventType: NotificationEventType.SUBMISSION_RECEIPT,
      idempotencyKey,
      recipientEmail: "test@example.com",
      recipientName: "Test User",
      subject: "Final account deletion notice",
      html: "<p>Final notice</p>",
      text: "Final notice",
      noticeId,
      accountDeletionRequestId: requestId,
    };

    await queueNotification(payload);
    await processNotification(payload);

    const notice = await prisma.accountDeletionNotice.findUnique({ where: { id: noticeId } });
    expect(notice?.status).toBe("SENT");

    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    expect(request?.status).toBe("CANCELLED");
  });
});
