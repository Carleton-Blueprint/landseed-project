/**
 * Redis-backed job queues (BullMQ). virusScanQueue: for scanning uploaded files; aiJobsQueue: for
 * OpenAI or other AI tasks. Create workers with createVirusScanWorker / createAiJobsWorker and run
 * them in a separate process or serverless handler. Set REDIS_URL in env.
 *
 * Two separate connections, per BullMQ's own guidance for producers vs. consumers: Queue.add()
 * callers (Vercel API routes, and services invoked from within worker processes) use
 * producerConnection, which fails fast when Redis is unreachable instead of hanging — important
 * since a Vercel serverless function has a hard execution timeout it would otherwise hang toward.
 * Worker instances use workerConnection, which retries indefinitely, since a long-lived Railway
 * worker process can afford to wait out a Redis blip.
 */
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const producerConnection = new IORedis(redisUrl, {
  // Bounded (unlike workerConnection below): a command still in flight when
  // the connection drops should fail fast, not wait out reconnect attempts
  // indefinitely — enableOfflineQueue only fails fast for commands issued
  // while already disconnected, not ones that were already sent.
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 5000,
});

const workerConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const virusScanQueue = new Queue<{ key: string; photoId: string; bucket?: string }>("virus-scan", {
  connection: producerConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

export const aiJobsQueue = new Queue<{ jobType: string; payload: unknown }>("ai-jobs", {
  connection: producerConnection,
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
  previousTotal?: number;
  newTotal?: number;
  questionCategory?: string;
  questionSubject?: string;
  fileName?: string;
  documentType?: string;
  manualReviewReason?: string;
  manualReviewDescription?: string;
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
  senderId?: string;
  linkedResourceId?: string;
  informationRequestType?: string;
  informationRequestMessage?: string;
  newEmail?: string | null;
}>("email", {
  connection: producerConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
});

export const manualReviewQueue = new Queue<{
  projectId: string;
  // Omitted for triggers with no EligibilityAssessment (e.g. photo analysis) —
  // the worker's stale-evaluation guard only applies when this is present.
  assessmentId?: string;
  aiConfidence: "HIGH" | "MEDIUM" | "LOW";
  complexityScore?: number;
  reason?: string;
  photoId?: string;
  metadata?: Record<string, unknown>;
}>("manual-review", {
  connection: producerConnection,
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
  connection: producerConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 } },
});

export const estimateGenerationQueue = new Queue<{
  projectId: string;
  actorUserId?: string;
}>("estimate-generation", {
  connection: producerConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export const grantMatchSummaryQueue = new Queue<{
  projectId: string;
  actorUserId: string;
  force?: boolean;
}>("grant-match-summary", {
  connection: producerConnection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 } },
});

export function createVirusScanWorker(
  processor: (job: { data: { key: string; photoId: string; bucket?: string } }) => Promise<void>
) {
  return new Worker("virus-scan", processor, { connection: workerConnection });
}

export function createAiJobsWorker(
  processor: (job: { data: { jobType: string; payload: unknown } }) => Promise<void>
) {
  return new Worker("ai-jobs", processor, { connection: workerConnection });
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
      previousTotal?: number;
      newTotal?: number;
      questionCategory?: string;
      questionSubject?: string;
      fileName?: string;
      documentType?: string;
      manualReviewReason?: string;
      manualReviewDescription?: string;
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
      senderId?: string;
      linkedResourceId?: string;
      informationRequestType?: string;
      informationRequestMessage?: string;
      newEmail?: string | null;
    };
  }) => Promise<void>
) {
  return new Worker("email", processor, { connection: workerConnection });
}

export function createManualReviewWorker(
  processor: (job: {
    data: {
      projectId: string;
      assessmentId?: string;
      aiConfidence: "HIGH" | "MEDIUM" | "LOW";
      complexityScore?: number;
      reason?: string;
      photoId?: string;
      metadata?: Record<string, unknown>;
    };
  }) => Promise<void>
) {
  return new Worker("manual-review", processor, { connection: workerConnection });
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
  return new Worker("manual-fallback-export", processor, { connection: workerConnection });
}

export function createEstimateGenerationWorker(
  processor: (job: {
    data: {
      projectId: string;
      actorUserId?: string;
    };
  }) => Promise<void>
) {
  return new Worker("estimate-generation", processor, { connection: workerConnection });
}

export function createGrantMatchSummaryWorker(
  processor: (job: {
    data: {
      projectId: string;
      actorUserId: string;
      force?: boolean;
    };
  }) => Promise<void>
) {
  return new Worker("grant-match-summary", processor, { connection: workerConnection });
}

// Some tests mock bullmq/ioredis themselves and load this module for real to
// inspect constructor args, which leaves virusScanQueue etc. as plain mock
// objects with no .close()/.quit().
// Guard each call so closeQueueConnections is safe regardless of whether the
// underlying bullmq/ioredis instances are real or mocked.
async function closeIfCloseable(target: { close?: () => Promise<unknown> }): Promise<void> {
  if (typeof target.close === "function") {
    await target.close();
  }
}

// BullMQ does not close an externally-provided connection when a Queue is
// closed, since it assumes the caller owns that connection's lifecycle.
// Callers (e.g. test teardown) that want to fully release the shared
// producer connection must close all queues first, then this. Workers (and
// workerConnection) are closed separately via shutdownRegistry.
export async function closeQueueConnections(): Promise<void> {
  await Promise.all([
    closeIfCloseable(virusScanQueue),
    closeIfCloseable(aiJobsQueue),
    closeIfCloseable(emailQueue),
    closeIfCloseable(manualReviewQueue),
    closeIfCloseable(manualFallbackExportQueue),
    closeIfCloseable(estimateGenerationQueue),
    closeIfCloseable(grantMatchSummaryQueue),
  ]);
  if (typeof producerConnection.quit === "function") {
    await producerConnection.quit();
  }
}