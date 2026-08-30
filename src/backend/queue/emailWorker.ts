import "dotenv/config";
import { NotificationEventType } from "@prisma/client";
import { createEmailWorker } from "@/backend/queue";
import { registerShutdownHandler } from "@/backend/queue/shutdownRegistry";
import { processNotification } from "@/backend/notifications/service";
import { recordFailureAndMaybeAlert } from "@/backend/services/criticalFailureAlerts";
import { ALERT_THRESHOLD_KEYS } from "@/backend/services/alertThresholds";

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
    previousTotal: job.data.previousTotal,
    newTotal: job.data.newTotal,
    questionCategory: job.data.questionCategory,
    questionSubject: job.data.questionSubject,
    fileName: job.data.fileName,
    documentType: job.data.documentType,
    manualReviewReason: job.data.manualReviewReason,
    manualReviewDescription: job.data.manualReviewDescription,
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
    senderId: job.data.senderId,
    linkedResourceId: job.data.linkedResourceId,
    informationRequestType: job.data.informationRequestType,
    informationRequestMessage: job.data.informationRequestMessage,
    newEmail: job.data.newEmail,
  });
});

worker.on("completed", (job) => {
  console.log(`Email job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err.message);

  const maxAttempts = job?.opts.attempts ?? 3;
  if (job && job.attemptsMade >= maxAttempts) {
    void recordFailureAndMaybeAlert({
      key: ALERT_THRESHOLD_KEYS.EMAIL_DELIVERY_FAILURE,
      summary: `Email delivery failed after ${job.attemptsMade} attempts (eventType: ${job.data.eventType})`,
      details: { jobId: job.id, eventType: job.data.eventType, errorMessage: err.message },
    });
  }
});

worker.on("error", (err) => {
  console.error("Email worker error:", err);
});

console.log("Email worker started and listening on queue: email");

registerShutdownHandler("email", async () => {
  await worker.close();
});