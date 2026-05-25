/** @jest-environment node */

import { prisma } from "lib/prisma";
import { queueNotification, processNotification } from "@/backend/notifications/service";
import { createAccountDeletionNotice, requestAccountDeletion } from "@/backend/services/accountDeletionRetention";
import { AccountDeletionNoticeType, NotificationEventType } from "@prisma/client";

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(async () => ({ provider: "test", messageId: "msg-1" })),
}));

describe("Account deletion notification flow", () => {
  let userId: string;
  let requestId: string;
  let noticeId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-${Date.now()}@example.com`, name: "Test User" },
    });
    userId = user.id;

    const req = await requestAccountDeletion({ targetUserId: userId, requestedByUserId: userId });
    requestId = req.id;

    noticeId = await createAccountDeletionNotice({
      requestId,
      noticeType: AccountDeletionNoticeType.ADVANCE_NOTICE,
    });
  });

  afterAll(async () => {
    // cleanup created records
    await prisma.accountDeletionNotice.deleteMany({ where: { accountDeletionRequestId: requestId } });
    await prisma.accountDeletionRequest.deleteMany({ where: { id: requestId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey: `test-notice:${noticeId}` } });
    await prisma.$disconnect();
  });

  it("queues and processes notice via NotificationDelivery and marks notice SENT", async () => {
    const idempotencyKey = `test-notice:${noticeId}`;

    const payload = {
      eventType: NotificationEventType.SUBMISSION_RECEIPT,
      idempotencyKey,
      recipientEmail: "test@example.com",
      recipientName: "Test User",
      subject: "Account deletion advance notice",
      html: "<p>Advance notice</p>",
      text: "Advance notice",
      noticeId,
      accountDeletionRequestId: requestId,
    } as const;

    await queueNotification(payload as any);
    await processNotification(payload as any);

    const notice = await prisma.accountDeletionNotice.findUnique({ where: { id: noticeId } });
    expect(notice).not.toBeNull();
    expect(notice?.status).toBe("SENT");
    expect(notice?.sentAt).not.toBeNull();
  });
});
