/** @jest-environment node */

import { prisma } from "lib/prisma";
import { queueNotification, processNotification } from "@/backend/notifications/service";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import {
  createAccountDeletionNotice,
  requestAccountDeletion,
  finalizeAccountDeletionRequest,
} from "@/backend/services/accountDeletionRetention";
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
      data: { email: `test-${Date.now()}@example.com`, name: "Test User", phone: "555-555-5555" },
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
    await prisma.accountDeletionNotice.deleteMany({ where: { accountDeletionRequestId: requestId } });
    await prisma.accountDeletionRequest.deleteMany({ where: { id: requestId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey: `test-notice:${noticeId}` } });
    await prisma.$disconnect();
  });

  it("queues and processes advance notice and marks notice SENT", async () => {
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
    };

    await queueNotification(payload);
    await processNotification(payload);

    const notice = await prisma.accountDeletionNotice.findUnique({ where: { id: noticeId } });
    expect(notice?.status).toBe("SENT");
    expect(notice?.sentAt).not.toBeNull();
  });

  it("transitions request to IN_GRACE_PERIOD after advance notice is sent", async () => {
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    expect(request?.status).toBe("IN_GRACE_PERIOD");
  });

  it("does not re-send a notice that is already SENT (idempotency)", async () => {
    const mockSend = sendTransactionalEmail as jest.Mock;
    mockSend.mockClear();

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
    };

    await processNotification(payload);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("queues and processes final notice and transitions request to READY_FOR_DELETION", async () => {
    const finalNoticeId = await createAccountDeletionNotice({
      requestId,
      noticeType: AccountDeletionNoticeType.FINAL_NOTICE,
    });

    const idempotencyKey = `test-final-notice:${finalNoticeId}`;
    const payload = {
      eventType: NotificationEventType.SUBMISSION_RECEIPT,
      idempotencyKey,
      recipientEmail: "test@example.com",
      recipientName: "Test User",
      subject: "Final account deletion notice",
      html: "<p>Final notice</p>",
      text: "Final notice",
      noticeId: finalNoticeId,
      accountDeletionRequestId: requestId,
    };

    await queueNotification(payload);
    await processNotification(payload);

    const notice = await prisma.accountDeletionNotice.findUnique({ where: { id: finalNoticeId } });
    expect(notice?.status).toBe("SENT");

    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    expect(request?.status).toBe("READY_FOR_DELETION");

    // cleanup extra notice
    await prisma.accountDeletionNotice.deleteMany({ where: { id: finalNoticeId } });
    await prisma.notificationDelivery.deleteMany({ where: { idempotencyKey } });
  });

  it("finalizes the request and wipes PII", async () => {
    await finalizeAccountDeletionRequest({ requestId });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBeNull();
    expect(user?.name).toBeNull();
    expect(user?.phone).toBeNull();
    expect(user?.image).toBeNull();

    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    expect(request?.status).toBe("DELETED");
    expect(request?.deletedAt).not.toBeNull();
  });

  it("does not re-finalize an already deleted request", async () => {
    // Should return silently without throwing
    await expect(finalizeAccountDeletionRequest({ requestId })).resolves.toBeUndefined();

    // Status should still be DELETED, not changed
    const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
    expect(request?.status).toBe("DELETED");
  });
});