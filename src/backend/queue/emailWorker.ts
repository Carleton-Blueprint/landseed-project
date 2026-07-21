import "dotenv/config";
import { NotificationEventType } from "@prisma/client";
import { createEmailWorker } from "@/backend/queue";
import { processNotification } from "@/backend/notifications/service";

const worker = createEmailWorker(async (job) => {
  const eventType = job.data.eventType as NotificationEventType;

  if (!Object.values(NotificationEventType).includes(eventType)) {
    throw new Error(`Unsupported notification event type: ${job.data.eventType}`);
  }

  await processNotification({
    eventType,
    idempotencyKey: job.data.idempotencyKey,
    recipientEmail: job.data.recipientEmail,
    recipientName: job.data.recipientName,
    userId: job.data.userId,
    projectId: job.data.projectId,
    projectAddress: job.data.projectAddress,
    estimateLink: job.data.estimateLink,
    estimateMin: job.data.estimateMin,
    estimateMax: job.data.estimateMax,
    // pass through optional overrides and account-deletion linkage
    subject: job.data.subject,
    html: job.data.html,
    text: job.data.text,
    noticeId: job.data.noticeId,
    accountDeletionRequestId: job.data.accountDeletionRequestId,
    scheduledFor: job.data.scheduledFor,
    authActionLink: job.data.authActionLink,
    seniorName: job.data.seniorName,
    isCaregiverSubmission: job.data.isCaregiverSubmission,
    newEmail: job.data.newEmail,
  });
});

worker.on("completed", (job) => {
  console.log(`Email job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Email worker error:", err);
});

console.log("Email worker started and listening on queue: email");

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
