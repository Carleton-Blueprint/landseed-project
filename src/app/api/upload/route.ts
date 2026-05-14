/**
 * API route: POST /api/upload — accepts multipart/form-data photo uploads.
 * Validates file presence, size (max 10MB), and type (JPEG, PNG, WebP). 
 * Uploads to S3, creates Photo record, and queues virus scan job.
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadToS3 } from "lib/s3";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole } from "@prisma/client";
import { virusScanQueue } from "@/backend/queue";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - must be signed in" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("photo");
    const projectId = formData.get("projectId");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing or invalid file in form field 'file' or 'photo'" },
        { status: 400 }
      );
    }

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    const canUploadToProject = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.EDITOR
    );
    if (!canUploadToProject) {
      return NextResponse.json(
        { error: "Unauthorized access to project" },
        { status: 403 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP." },
        { status: 400 }
      );
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const extension = file.name.split('.').pop() || 'jpg';
    const uniqueFilename = `${timestamp}-${randomId}.${extension}`;
    
    // Use project-specific folder
    const s3Key = `projects/${projectId}/photos/${uniqueFilename}`;

    // Convert file to buffer and upload to S3
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const s3Url = await uploadToS3(buffer, s3Key, file.type);

    // Create Photo record in database with "pending" status
    const photo = await prisma.photo.create({
      data: {
        url: s3Url,
        projectId: projectId,
        virus_scan_status: "pending",
      },
    });

    // Add virus scan job to Redis queue (non-blocking)
    // The worker will process this asynchronously
    await virusScanQueue.add(
      `scan-${photo.id}`,  // Job name (unique identifier)
      { 
        key: s3Key,                              // S3 file path
        photoId: photo.id,                       // Database record ID
        bucket: process.env.AWS_S3_BUCKET   // S3 bucket name
      },
      { 
        priority: 1,              // High priority (1 = highest)
        removeOnComplete: 100,    // Keep last 100 completed jobs for debugging
        removeOnFail: 500,        // Keep last 500 failed jobs for analysis
      }
    );

    console.log(`✅ Photo ${photo.id} uploaded. Virus scan job queued.`);

    return NextResponse.json({
      success: true,
      photo,
      message: "File uploaded successfully! Virus scan in progress...",
      warning: "This file cannot be used in grant applications until the virus scan is complete. This typically takes 10-30 seconds.",
      scanStatus: "pending",
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
