/**
 * Virus Scan Worker - Processes virus scanning jobs from Redis queue
 * 
 * RUNS SEPARATELY from Next.js app (different process/terminal)
 * 
 * How to run:
 *   npm run worker:virus-scan
 * 
 * What it does:
 *   1. Polls Redis queue for new scan jobs
 *   2. Downloads file from S3
 *   3. Scans for viruses using ClamAV
 *   4. Updates Photo.virus_scan_status in database
 *   5. Deletes infected files (if found)
 * 
 * Job Flow:
 *   Upload API → Redis Queue → This Worker → ClamAV → Database Update
 */

import "dotenv/config";
import { createVirusScanWorker, aiJobsQueue } from "./index";
import { prisma } from "lib/prisma";
import { PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE } from "@/backend/services/photoAnalysis";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import NodeClam from "clamscan";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Readable } from "stream";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE,
  type AccessibilityImageGenerationJobPayload,
} from "@/backend/services/imageGeneration";
import { isLiveImageGenerationEnabled } from "lib/openai";

// Initialize S3 client for downloading files to scan
const AWS_REGION = process.env.AWS_REGION ?? "ca-central-1";
const s3Client = new S3Client({
  region: AWS_REGION,
  endpoint: `https://s3.${AWS_REGION}.amazonaws.com`,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
});

// Initialize ClamAV scanner
let clamScanner: NodeClam | null = null;

async function getClamScanner(): Promise<NodeClam> {
  if (!clamScanner) {
    const clamscan = await new NodeClam().init({
      clamdscan: {
        host: process.env.CLAMAV_HOST ?? "localhost",
        port: parseInt(process.env.CLAMAV_PORT ?? "3310"),
      },
      preference: "clamdscan", // Use network scanner (clamd)
    });
    clamScanner = clamscan;
    console.log("✅ ClamAV scanner initialized");
  }
  return clamScanner;
}

/**
 * Helper function to convert stream to buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Virus scanning with ClamAV
 * Downloads file from S3, scans it, and returns result
 */
async function scanFileForVirus(s3Key: string, bucket: string): Promise<"clean" | "infected"> {
  console.log(`  📥 Downloading file from S3: ${s3Key}`);
  
  let tempFilePath: string | null = null;
  
  try {
    // Download file from S3
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });
    
    const response = await s3Client.send(command);
    const fileStream = response.Body;
    
    if (!fileStream || !(fileStream instanceof Readable)) {
      throw new Error("Failed to download file from S3");
    }

    // Convert stream to buffer and save to temp file
    const fileBuffer = await streamToBuffer(fileStream);
    const fileName = s3Key.split("/").pop() ?? "temp-file";
    tempFilePath = join(tmpdir(), `scan-${Date.now()}-${fileName}`);
    
    await writeFile(tempFilePath, fileBuffer);
    console.log(`  💾 Saved to temp file: ${tempFilePath}`);

    // Scan with ClamAV
    console.log(`  🔍 Scanning for viruses with ClamAV...`);
    const clam = await getClamScanner();
    const { isInfected, viruses } = await clam.scanFile(tempFilePath);
    
    if (isInfected) {
      console.log(`  ⚠️  VIRUS DETECTED: ${viruses.join(", ")}`);
      return "infected";
    }
    
    console.log(`  ✅ Scan complete: clean`);
    return "clean";
    
  } catch (error) {
    console.error(`  ❌ Error scanning file:`, error);
    throw error;
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log(`  🗑️  Cleaned up temp file`);
      } catch (cleanupError) {
        console.warn(`  ⚠️  Failed to cleanup temp file: ${cleanupError}`);
      }
    }
  }
}

/**
 * Create the worker and define the job processor
 * This runs for each job pulled from the Redis queue
 */
const worker = createVirusScanWorker(async (job) => {
  const { key, photoId, bucket } = job.data;
  const bucketName = bucket ?? process.env.AWS_S3_BUCKET ?? "";

  console.log(`\n🔍 Processing virus scan job for ${photoId}`);
  console.log(`   S3 Key: ${key}`);
  console.log(`   Bucket: ${bucketName}`);

  try {
    // Perform the virus scan
    const scanResult = await scanFileForVirus(key, bucketName);

    // Determine if this is a document or photo scan
    const document = await prisma.document.findUnique({
      where: { id: photoId },
      include: { project: { include: { user: true } } },
    });

    const photo = !document
      ? await prisma.photo.findUnique({
          where: { id: photoId },
          include: { project: { include: { user: true } } },
        })
      : null;

    const isDocument = !!document;
    const resource = document || photo;

    if (!resource) {
      throw new Error(`Resource not found for ID: ${photoId}`);
    }

    if (scanResult === "infected") {
      // ❌ MALWARE DETECTED
      console.warn(`\n⚠️  MALWARE DETECTED: ${key}`);

      // 1. Update status to "infected"
      if (isDocument) {
        await prisma.document.update({
          where: { id: photoId },
          data: { virusScanStatus: "infected" },
        });
      } else {
        await prisma.photo.update({
          where: { id: photoId },
          data: { virus_scan_status: "infected" },
        });
      }

      // 2. Delete infected file from S3
      console.log(`   🗑️  Deleting infected file from S3...`);
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await s3Client.send(deleteCommand);
      console.log(`   ✅ Infected file deleted: ${key}`);

      // 3. Log audit event for security tracking
      const fileName = document?.fileName || "photo";
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "MALWARE_DETECTED",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: resource.project.userId, // file uploader
        projectId: resource.projectId,
        resourceType: isDocument ? "document" : "photo",
        resourceId: photoId,
        description: `Malware detected and quarantined in uploaded file: ${fileName}`,
        metadata: {
          fileName,
          s3Key: key,
          scanResult: "infected",
          detectedAt: new Date().toISOString(),
        },
      });

      // 4. Send notification email to uploader
      const user = resource.project.user;
      if (user?.email) {
        const documentType = document?.documentType || undefined;
        
        try {
          await enqueueNotification({
            eventType: "FILE_MALWARE_DETECTED",
            idempotencyKey: `malware-${photoId}-${Date.now()}`,
            recipientEmail: user.email,
            recipientName: user.name,
            userId: user.id,
            projectId: resource.projectId,
            projectAddress: resource.project.address || undefined,
            fileName: document?.fileName || "uploaded photo",
            documentType,
          });

          console.log(`   📧 Malware notification queued for ${user.email}`);
        } catch (notificationError) {
          console.warn(`   ⚠️  Failed to queue malware notification:`, notificationError);
        }
      }
    } else {
      // ✅ CLEAN FILE
      console.log(`   ✅ File is clean: ${key}`);

      if (isDocument) {
        await prisma.document.update({
          where: { id: photoId },
          data: { virusScanStatus: "clean" },
        });
      } else {
        await prisma.photo.update({
          where: { id: photoId },
          data: { virus_scan_status: "clean" },
        });

        // Queue AI photo analysis now that the photo is confirmed clean. Photos only —
        // documents (grant PDFs, etc.) aren't candidates for modification-type inference.
        try {
          await aiJobsQueue.add(
            "ai-jobs",
            { jobType: PHOTO_MODIFICATION_ANALYSIS_JOB_TYPE, payload: { photoId } },
            { jobId: `photo-analysis-${photoId}`, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } }
          );
          console.log(`   🤖 Queued photo modification analysis for ${photoId}`);
        } catch (queueError) {
          console.warn(`   ⚠️  Failed to queue photo analysis for ${photoId}:`, queueError);
        }

        if (isLiveImageGenerationEnabled()) {
          try {
            const jobPayload: AccessibilityImageGenerationJobPayload = { photoId };
            await aiJobsQueue.add(`accessibility-image-generation:${photoId}`, {
              jobType: ACCESSIBILITY_IMAGE_GENERATION_JOB_TYPE,
              payload: jobPayload,
            });
            console.log(`   🖼️  Queued accessibility image generation for photo ${photoId}`);
          } catch (queueError) {
            console.warn(`   ⚠️  Failed to queue image generation for ${photoId}:`, queueError);
          }
        }
      }

      console.log(`✅ Virus scan completed: CLEAN`);
    }
    
  } catch (error) {
    console.error(`❌ Failed to scan ${photoId}:`, error);
    
    // Update status to "failed"
    try {
      const isDoc = await prisma.document.findUnique({ where: { id: photoId } });
      if (isDoc) {
        await prisma.document.update({
          where: { id: photoId },
          data: { virusScanStatus: "failed" },
        });
      } else {
        await prisma.photo.update({
          where: { id: photoId },
          data: { virus_scan_status: "failed" },
        });
      }
    } catch (updateError) {
      console.error("Failed to update scan status:", updateError);
    }

    throw error; // BullMQ will retry (3 attempts)
  }
});

// Event handlers for monitoring worker health

worker.on("completed", (job) => {
  console.log(`✅ Job "${job.id}" completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job "${job?.id}" failed:`, err.message);
  console.error(`   Will retry (${job?.attemptsMade}/${job?.opts.attempts} attempts)`);
});

worker.on("error", (err) => {
  console.error("⚠️  Worker error:", err);
});

// Startup message
console.log("\n" + "=".repeat(60));
console.log("🔍 VIRUS SCAN WORKER STARTED (ClamAV)");
console.log("=".repeat(60));
console.log(`📡 Redis: ${process.env.REDIS_URL ?? "redis://localhost:6379"}`);
console.log(`📦 S3 Region: ${process.env.AWS_REGION ?? "ca-central-1"}`);
console.log(`🪣 S3 Bucket: ${process.env.AWS_S3_BUCKET ?? "(not set)"}`);
console.log(`🛡️  ClamAV: ${process.env.CLAMAV_HOST ?? "localhost"}:${process.env.CLAMAV_PORT ?? "3310"}`);
console.log(`⏳ Waiting for jobs from queue: "virus-scan"`);
console.log("=".repeat(60) + "\n");

// Graceful shutdown handler
// Triggered by Ctrl+C or system signals
process.on("SIGTERM", async () => {
  console.log("\n⚠️  SIGTERM received. Closing worker gracefully...");
  await worker.close();
  console.log("✅ Worker closed. Exiting.");
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n⚠️  SIGINT received (Ctrl+C). Closing worker gracefully...");
  await worker.close();
  console.log("✅ Worker closed. Exiting.");
  process.exit(0);
});
