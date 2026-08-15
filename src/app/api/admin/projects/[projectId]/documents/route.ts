/**
 * API route: GET /api/admin/projects/[projectId]/documents — lists all documents for a project (admin).
 * API route: POST /api/admin/projects/[projectId]/documents — uploads a document (admin).
 */
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { requireMinimumRole } from "@/backend/auth/requireRole";
import { uploadToS3 } from "lib/s3";
import { virusScanQueue } from "@/backend/queue";
import { DocumentType } from "@prisma/client";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    await requireMinimumRole(session, "ADMIN"); // Admin can view

    const documents = await prisma.document.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        documentType: true,
        label: true,
        virusScanStatus: true,
        reviewStatus: true,
        reviewNote: true,
        createdAt: true,
        isClientVisible: true,
      },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Error fetching admin documents:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    await requireMinimumRole(session, "ADMIN"); // Admin can upload

    const formData = await request.formData();
    const file = formData.get("file");
    const documentType = formData.get("documentType") as DocumentType;
    const isClientVisibleStr = formData.get("isClientVisible");
    
    let isClientVisible = true;
    if (isClientVisibleStr === "false") {
      isClientVisible = false;
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing or invalid file" }, { status: 400 });
    }

    if (!documentType || typeof documentType !== "string") {
      return NextResponse.json({ error: "Missing or invalid documentType" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 15MB." }, { status: 400 });
    }

    const fileExtension = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP, DOCX." },
        { status: 400 }
      );
    }

    // Convert file to buffer and upload to S3
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const s3Key = `projects/${projectId}/documents/${timestamp}-${randomId}${fileExtension}`;
    
    const s3Url = await uploadToS3(buffer, s3Key, file.type);

    const document = await prisma.document.create({
      data: {
        projectId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        s3Key,
        s3Url,
        documentType,
        virusScanStatus: "pending",
        uploadedByUserId: session!.user!.id,
        isClientVisible,
      },
    });

    try {
      await virusScanQueue.add(`scan-doc-${document.id}`, { 
        key: s3Key, 
        photoId: document.id, 
        bucket: process.env.AWS_S3_BUCKET 
      });
    } catch (qErr) {
      console.error("Failed to enqueue virus scan:", qErr);
      // Non-fatal
    }

    return NextResponse.json({ document, message: "Document uploaded successfully!" }, { status: 201 });
  } catch (error) {
    console.error("Error uploading admin document:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
