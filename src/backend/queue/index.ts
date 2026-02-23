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

export const virusScanQueue = new Queue<{ key: string; bucket?: string }>("virus-scan", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
});

export const aiJobsQueue = new Queue<{ jobType: string; payload: unknown }>("ai-jobs", {
  connection,
  defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 2000 } },
});

export function createVirusScanWorker(
  processor: (job: { data: { key: string; bucket?: string } }) => Promise<void>
) {
  return new Worker("virus-scan", processor, { connection });
}

export function createAiJobsWorker(
  processor: (job: { data: { jobType: string; payload: unknown } }) => Promise<void>
) {
  return new Worker("ai-jobs", processor, { connection });
}
