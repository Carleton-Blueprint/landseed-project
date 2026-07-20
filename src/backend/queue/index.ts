/**
 * Redis-backed job queues (BullMQ). virusScanQueue: for scanning uploaded files; aiJobsQueue: for
 * OpenAI or other AI tasks. Create workers with createVirusScanWorker / createAiJobsWorker and run
 * them in a separate process or serverless handler. Set REDIS_URL in env.
 */
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const virusScanQueue = new Queue<{ key: string; photoId: string; bucket?: string }>("virus-scan", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

export const aiJobsQueue = new Queue<{ jobType: string; payload: unknown }>("ai-jobs", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
});

export const emailQueue = new Queue<{
  eventType: string;
  idempotencyKey: string;
  recipientEmail: string;
  recipientName?: string | null;
  userId?: string;
  projectId?: string;
  projectAddress?: string | null;
  estimateLink?: string | null;
  estimateMin?: number;
  estimateMax?: number;
  manualFallbackExportLink?: string | null;
  manualFallbackExportRetentionDays?: number;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  noticeId?: string | null;
  accountDeletionRequestId?: string | null;
  scheduledFor?: string | null;
  authActionLink?: string | null;
  seniorName?: string | null;
  isCaregiverSubmission?: boolean;
}>("email", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
});

export const builderTrendTransferQueue = new Queue<{
  transferId: string;
}>("buildertrend-transfer", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export const manualReviewQueue = new Queue<{
  projectId: string;
  assessmentId: string;
  aiConfidence: "HIGH" | "MEDIUM" | "LOW";
  complexityScore?: number;
  reason?: string;
}>("manual-review", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

export const manualFallbackExportQueue = new Queue<{
  exportRequestId: string;
  projectId: string;
  requestedByUserId: string;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
  requestedAt: string;
  retentionDays: number;
  maxSizeBytes?: number;
}>("manual-fallback-export", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 } },
});

export const estimateGenerationQueue = new Queue<{
  projectId: string;
  actorUserId?: string;
}>("estimate-generation", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export function createVirusScanWorker(
  processor: (job: { data: { key: string; photoId: string; bucket?: string } }) => Promise<void>
) {
  return new Worker("virus-scan", processor, { connection });
}

export function createAiJobsWorker(
  processor: (job: { data: { jobType: string; payload: unknown } }) => Promise<void>
) {
  return new Worker("ai-jobs", processor, { connection });
}

export function createEmailWorker(
  processor: (job: {
    data: {
      eventType: string;
      idempotencyKey: string;
      recipientEmail: string;
      recipientName?: string | null;
      userId?: string;
      projectId?: string;
      projectAddress?: string | null;
      estimateLink?: string | null;
      estimateMin?: number;
      estimateMax?: number;
      subject?: string | null;
      html?: string | null;
      text?: string | null;
      noticeId?: string | null;
      accountDeletionRequestId?: string | null;
      scheduledFor?: string | null;
      manualFallbackExportLink?: string | null;
      manualFallbackExportRetentionDays?: number;
      authActionLink?: string | null;
      seniorName?: string | null;
      isCaregiverSubmission?: boolean;
    };
  }) => Promise<void>
) {
  return new Worker("email", processor, { connection });
}

export function createBuilderTrendTransferWorker(
  processor: (job: {
    data: {
      transferId: string;
    };
    attemptsMade: number;
    opts: { attempts?: number };
  }) => Promise<void>
) {
  return new Worker("buildertrend-transfer", processor, { connection });
}

export function createManualReviewWorker(
  processor: (job: {
    data: {
      projectId: string;
      assessmentId: string;
      aiConfidence: "HIGH" | "MEDIUM" | "LOW";
      complexityScore?: number;
      reason?: string;
    };
  }) => Promise<void>
) {
  return new Worker("manual-review", processor, { connection });
}

export function createManualFallbackExportWorker(
  processor: (job: {
    data: {
      exportRequestId: string;
      projectId: string;
      requestedByUserId: string;
      requestedByEmail?: string | null;
      requestedByName?: string | null;
      requestedAt: string;
      retentionDays: number;
      maxSizeBytes?: number;
    };
  }) => Promise<void>
) {
  return new Worker("manual-fallback-export", processor, { connection });
}

export function createEstimateGenerationWorker(
  processor: (job: {
    data: {
      projectId: string;
      actorUserId?: string;
    };
  }) => Promise<void>
) {
  return new Worker("estimate-generation", processor, { connection });
}
