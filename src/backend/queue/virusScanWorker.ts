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

import { createVirusScanWorker } from "./index";
import { prisma } from "lib/prisma";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import NodeClam from "clamscan";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Readable } from "stream";

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

  console.log(`\n🔍 Processing virus scan job for Photo ${photoId}`);
  console.log(`   S3 Key: ${key}`);
  console.log(`   Bucket: ${bucketName}`);

  try {
    // Perform the virus scan
    const scanResult = await scanFileForVirus(key, bucketName);

    if (scanResult === "infected") {
      // INFECTED FILE FOUND!
      console.warn(`\n⚠️  MALWARE DETECTED: ${key}`);
      
      // Update database to mark as infected
      await prisma.photo.update({
        where: { id: photoId },
        data: { virus_scan_status: "infected" },
      });

      // Delete the infected file from S3
      console.log(`   🗑️  Deleting infected file from S3...`);
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await s3Client.send(deleteCommand);
      console.log(`   ✅ Infected file deleted: ${key}`);

      // TODO: Send notification to admin/user
      // await sendNotificationEmail({
      //   type: "infected_file",
      //   photoId,
      //   filename: key
      // });

    } else {
      // File is clean
      console.log(`   ✅ File is clean: ${key}`);
      
      // Update database to mark as clean
      await prisma.photo.update({
        where: { id: photoId },
        data: { virus_scan_status: "clean" },
      });
    }

    console.log(`✅ Virus scan completed for Photo ${photoId}: ${scanResult}\n`);
    
  } catch (error) {
    console.error(`❌ Failed to scan Photo ${photoId}:`, error);
    
    // Mark as failed in database
    // BullMQ will automatically retry the job (3 attempts configured)
    await prisma.photo.update({
      where: { id: photoId },
      data: { virus_scan_status: "failed" },
    });

    // Re-throw error so BullMQ knows the job failed
    throw error;
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
