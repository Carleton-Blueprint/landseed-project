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
 *   3. Scans for viruses (placeholder - integrate ClamAV/VirusTotal later)
 *   4. Updates Photo.virus_scan_status in database
 *   5. Deletes infected files (if found)
 * 
 * Job Flow:
 *   Upload API → Redis Queue → This Worker → Database Update
 */

import { createVirusScanWorker } from "./index";
import { prisma } from "lib/prisma";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

/**
 * PLACEHOLDER: Virus scanning logic
 * 
 * In production, replace with one of these integrations:
 * 
 * Option 1 - ClamAV (Free, Open Source):
 *   npm install clamscan
 *   const clam = await clamscan.init();
 *   const { isInfected } = await clam.scanFile(filePath);
 * 
 * Option 2 - VirusTotal API (Cloud Service):
 *   npm install node-virustotal
 *   const vt = new VirusTotal(apiKey);
 *   const result = await vt.fileScan(fileBuffer);
 * 
 * Option 3 - AWS GuardDuty (Managed):
 *   Enable in AWS Console, auto-scans S3
 * 
 * For now: Simulates 2-second scan, always returns "clean"
 */
async function scanFileForVirus(s3Key: string, bucket: string): Promise<"clean" | "infected"> {
  console.log(`  📥 Downloading file from S3: ${s3Key}`);
  
  try {
    // Download file from S3
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });
    
    const response = await s3Client.send(command);
    const fileStream = response.Body;
    
    if (!fileStream) {
      throw new Error("Failed to download file from S3");
    }

    console.log(`  🔍 Scanning for viruses... (placeholder)`);
    
    // TODO: Replace this with actual virus scanning
    // Simulate scan delay (2 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // For now, always return "clean"
    // In production, this would be the result from ClamAV/VirusTotal/etc
    const scanResult = "clean";
    
    console.log(`  ✅ Scan complete: ${scanResult}`);
    return scanResult;
    
  } catch (error) {
    console.error(`  ❌ Error scanning file:`, error);
    throw error;
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
console.log("🔍 VIRUS SCAN WORKER STARTED");
console.log("=".repeat(60));
console.log(`📡 Connected to Redis: ${process.env.REDIS_URL ?? "redis://localhost:6379"}`);
console.log(`📦 S3 Region: ${process.env.AWS_REGION ?? "ca-central-1"}`);
console.log(`🪣 S3 Bucket: ${process.env.AWS_S3_BUCKET ?? "(not set)"}`);
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
