/**
 * S3 client placeholder for photo uploads. This file exposes the bucket name and a stub for the client.
 * When ready: install @aws-sdk/client-s3, implement getS3Client(), and set AWS_S3_BUCKET + AWS_* in env.
 */
import { S3Client, PutObjectCommand, ListBucketsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";
const AWS_REGION = process.env.AWS_REGION ?? "ca-central-1";

let s3Client: S3Client | null = null;

export function getS3Client() {
  // Placeholder: return actual S3 client instance
  if (!s3Client) {
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return s3Client;
}

// Helper to upload file to S3
export async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);
  
  // Return the S3 URL
  return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export async function getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn });
}

export async function getSignedDownloadUrlFromS3Url(
  s3Url: string,
  expiresIn: number = 3600
): Promise<string> {
  const parsedUrl = new URL(s3Url);
  const key = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));

  if (!key) {
    throw new Error("Cannot sign S3 URL without an object key");
  }

  return getSignedDownloadUrl(key, expiresIn);
}

// Helper function to test connection
export async function testS3Connection(): Promise<boolean> {
  try {
    const client = getS3Client();
    const command = new ListBucketsCommand({});
    await client.send(command);
    console.log('✅ S3 connection successful');
    return true;
  } catch (error) {
    console.error("❌ S3 connection failed:", error);
    return false;
  }
}
