/**
 * Cloudflare R2 client for photo/document uploads, accessed through the S3-compatible API
 * (@aws-sdk/client-s3 works unmodified against R2). Configured via R2_* env vars.
 */
import { S3Client, PutObjectCommand, ListBucketsCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

export const S3_BUCKET = process.env.R2_BUCKET ?? "";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
export const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

let s3Client: S3Client | null = null;

export function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return s3Client;
}

// Helper to upload file to S3
export async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string> {
  return uploadStreamToS3(buffer, key, contentType);
}

export async function uploadStreamToS3(
  body: Readable | Buffer,
  key: string,
  contentType: string,
  contentLength?: number
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(contentLength != null ? { ContentLength: contentLength } : {}),
  });

  await client.send(command);

  // Path-style URL, since R2 doesn't do virtual-hosted-style bucket subdomains
  return `${R2_ENDPOINT}/${S3_BUCKET}/${key}`;
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
  const path = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
  const key = path.startsWith(`${S3_BUCKET}/`) ? path.slice(S3_BUCKET.length + 1) : path;

  if (!key) {
    throw new Error("Cannot sign S3 URL without an object key");
  }

  return getSignedDownloadUrl(key, expiresIn);
}

export async function deleteObjectFromS3(key: string): Promise<void> {
  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await client.send(command);
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
