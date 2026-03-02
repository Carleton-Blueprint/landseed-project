/**
 * API route: POST /api/upload — accepts multipart/form-data photo uploads.
 * Validates file presence, size (max 10MB), and type (JPEG, PNG, WebP). S3 upload and virus-scan queue
 * are left as placeholders to wire in lib/s3 and src/backend/queue.
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadToS3 } from "lib/s3";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("photo");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing or invalid file in form field 'file' or 'photo'" },
        { status: 400 }
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
    
    // For now, use a test folder. Later: projects/{projectId}/photos/{filename}
    const s3Key = `test-uploads/${uniqueFilename}`;

    // Convert file to buffer and upload to S3
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const s3Url = await uploadToS3(buffer, s3Key, file.type);

    return NextResponse.json({
      success: true,
      url: s3Url,
      key: s3Key,
      name: file.name,
      size: file.size,
      type: file.type,
      message: "File uploaded successfully to S3!",
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
