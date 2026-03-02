/**
 * S3 client placeholder for photo uploads. This file exposes the bucket name and a stub for the client.
 * When ready: install @aws-sdk/client-s3, implement getS3Client(), and set AWS_S3_BUCKET + AWS_* in env.
 */
export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";

export function getS3Client() {
  // Placeholder: return actual S3 client instance
  // import { S3Client } from "@aws-sdk/client-s3";
  // return new S3Client({ region: process.env.AWS_REGION });
  return null;
}
