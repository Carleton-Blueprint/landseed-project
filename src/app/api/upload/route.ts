/**
 * API route: POST /api/upload — accepts multipart/form-data photo uploads.
 * Validates file presence, size (max 10MB), and type (JPEG, PNG, WebP). S3 upload and virus-scan queue
 * are left as placeholders to wire in lib/s3 and src/backend/queue.
 */
import { NextRequest, NextResponse } from "next/server";

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

    // Placeholder: persist via S3 and enqueue virus scan (see src/backend and lib/s3)
    // const buffer = await file.arrayBuffer();
    // await uploadToS3(buffer, file.name, file.type);
    // await virusScanQueue.add({ key: s3Key });

    return NextResponse.json({
      ok: true,
      name: file.name,
      size: file.size,
      type: file.type,
      message: "Upload accepted. Storage and virus scan to be wired.",
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
