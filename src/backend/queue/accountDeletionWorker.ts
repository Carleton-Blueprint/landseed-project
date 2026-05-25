import { prisma } from "lib/prisma";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { AccountDeletionNoticeStatus, AccountDeletionNoticeType } from "@prisma/client";

const SCAN_INTERVAL_MS = Number(process.env.ACCOUNT_DELETION_SCAN_INTERVAL_MS ?? 15 * 60 * 1000);

let isRunning = false;
let scanTimer: NodeJS.Timeout | null = null;

type AccountDeletionNoticeJob = {
  id: string;
  accountDeletionRequestId: string;
  noticeType: AccountDeletionNoticeType;
  recipientEmail: string;
  recipientName: string | null;
  subject: string | null;
};

async function processNotice(notice: AccountDeletionNoticeJob) {
  const subject =
    notice.subject ??
    (notice.noticeType === AccountDeletionNoticeType.ADVANCE_NOTICE
      ? "Your account is scheduled for deletion — advance notice"
      : "Final account deletion notice");

  const text = `Hello ${notice.recipientName ?? ""},\n\nThis is a notification regarding your account deletion request (request id: ${notice.accountDeletionRequestId}).\n\nIf you did not request this or wish to cancel, please sign in and cancel the request before the scheduled deletion date.`;

  const html = `<p>Hello ${notice.recipientName ?? ""},</p><p>This is a notification regarding your account deletion request (request id: ${notice.accountDeletionRequestId}).</p><p>If you did not request this or wish to cancel, please sign in and cancel the request before the scheduled deletion date.</p>`;

  try {
    const result = await sendTransactionalEmail({
      to: notice.recipientEmail,
      subject,
      html,
      text,
    });

    await prisma.accountDeletionNotice.update({
      where: { id: notice.id },
      data: {
        status: AccountDeletionNoticeStatus.SENT,
        sentAt: new Date(),
        metadata: { provider: result.provider, providerMessageId: result.messageId },
        lastError: null,
      },
    });

    // Transition parent request state
    if (notice.noticeType === AccountDeletionNoticeType.ADVANCE_NOTICE) {
      await prisma.accountDeletionRequest.updateMany({
        where: { id: notice.accountDeletionRequestId, status: "REQUESTED" },
        data: { status: "IN_GRACE_PERIOD" },
      });
    } else if (notice.noticeType === AccountDeletionNoticeType.FINAL_NOTICE) {
      await prisma.accountDeletionRequest.updateMany({
        where: { id: notice.accountDeletionRequestId },
        data: { status: "READY_FOR_DELETION" },
      });
    }

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ACCOUNT_DELETION_NOTICE_SENT",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      resourceType: "account_deletion_request",
      resourceId: notice.accountDeletionRequestId,
      description: `Sent ${notice.noticeType} to ${notice.recipientEmail}`,
      metadata: { noticeId: notice.id, provider: result.provider, providerMessageId: result.messageId },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await prisma.accountDeletionNotice.update({
      where: { id: notice.id },
      data: {
        status: AccountDeletionNoticeStatus.FAILED,
        failedAt: new Date(),
        lastError: errorMessage,
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ACCOUNT_DELETION_NOTICE_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      resourceType: "account_deletion_request",
      resourceId: notice.accountDeletionRequestId,
      description: `Failed to send ${notice.noticeType} to ${notice.recipientEmail}`,
      metadata: { noticeId: notice.id, error: errorMessage },
    });
  }
}

async function runScan() {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();
    const dueNotices = await prisma.accountDeletionNotice.findMany({
      where: { status: AccountDeletionNoticeStatus.PENDING, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: "asc" },
      take: 50,
    });

    for (const n of dueNotices) {
      // Atomically claim the notice by transitioning PENDING -> PROCESSING.
      // If count === 0, another worker already claimed it — skip to avoid duplicates.
      try {
        const claimed = await prisma.accountDeletionNotice.updateMany({
          where: { id: n.id, status: AccountDeletionNoticeStatus.PENDING },
          data: { status: AccountDeletionNoticeStatus.PROCESSING },
        });

        if (claimed.count === 0) continue;

        await processNotice(n);
      } catch (err) {
        console.error("Failed processing notice", n.id, err);
      }
    }
  } catch (err) {
    console.error("Account deletion worker scan failed:", err);
  } finally {
    isRunning = false;
  }
}

console.log("Account deletion worker started", { scanIntervalMs: SCAN_INTERVAL_MS });

void runScan();
scanTimer = setInterval(() => {
  void runScan();
}, SCAN_INTERVAL_MS);

process.on("SIGTERM", () => {
  if (scanTimer) clearInterval(scanTimer);
  process.exit(0);
});

process.on("SIGINT", () => {
  if (scanTimer) clearInterval(scanTimer);
  process.exit(0);
});
