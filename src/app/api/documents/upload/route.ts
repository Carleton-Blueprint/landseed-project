/**
 * API route: POST /api/documents/upload — accepts multipart/form-data document uploads.
 * Validates file presence, size (max 15MB), type (PDF, JPEG, PNG, DOCX).
 * Uploads to S3, creates Document record, and queues virus scan job.
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadToS3 } from "lib/s3";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { ProjectAccessRole } from "@prisma/client";
import { virusScanQueue } from "@/backend/queue";
import { getRequestAuditContext, logAuditEventNonBlocking } from "@/backend/audit/log";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];

const VALID_DOCUMENT_TYPES = [
  "PROOF_OF_INCOME",
  "MEDICAL_DOCUMENTATION",
  "PROPERTY_OWNERSHIP",
  "INSURANCE_DOCUMENT",
  "GOVERNMENT_ID",
  "TAX_ASSESSMENT",
  "DISABILITY_CERTIFICATE",
  "OTHER",
] as const;

export async function POST(request: NextRequest) {
  const requestContext = getRequestAuditContext(request);

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized - must be signed in" },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = formData.get("projectId");
    const documentType = formData.get("documentType");
    const label = formData.get("label");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing or invalid file in form field 'file'" },
        { status: 400 }
      );
    }

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    if (
      !documentType ||
      typeof documentType !== "string" ||
      !VALID_DOCUMENT_TYPES.includes(documentType as (typeof VALID_DOCUMENT_TYPES)[number])
    ) {
      return NextResponse.json(
        { error: "Missing or invalid documentType" },
        { status: 400 }
      );
    }

    // Check project access
    const canUpload = await hasProjectAccess(
      session.user.id,
      projectId,
      ProjectAccessRole.EDITOR
    );
    if (!canUpload) {
      await logAuditEventNonBlocking({
        category: "SENSITIVE_ACCESS",
        action: "DOCUMENT_UPLOAD",
        outcome: "DENIED",
        sensitivityLevel: "RESTRICTED",
        actorUserId: session.user.id,
        projectId,
        resourceType: "document",
        description: "Document upload denied due to missing project access",
        ...requestContext,
      });
      return NextResponse.json(
        { error: "Unauthorized access to project" },
        { status: 403 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 15MB." },
        { status: 400 }
      );
    }

    // Validate file type
    const fileExtension = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PDF, JPEG, PNG, WebP, DOCX." },
        { status: 400 }
      );
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const extension = file.name.split(".").pop() || "pdf";
    const uniqueFilename = `${timestamp}-${randomId}.${extension}`;

    // Use project-specific documents folder
    const s3Key = `projects/${projectId}/documents/${uniqueFilename}`;

    // Convert file to buffer and upload to S3
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const s3Url = await uploadToS3(buffer, s3Key, file.type);

    // Create Document record in database
    const document = await prisma.document.create({
      data: {
        projectId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        s3Key,
        s3Url,
        documentType: documentType as (typeof VALID_DOCUMENT_TYPES)[number],
        label: typeof label === "string" ? label : null,
        virusScanStatus: "pending",
        uploadedByUserId: session.user.id,
      },
    });

    // Queue virus scan job (non-blocking)
    try {
      await virusScanQueue.add(
        `scan-doc-${document.id}`,
        {
          key: s3Key,
          photoId: document.id, // reuse photoId field; worker handles both photo and document scans
          bucket: process.env.AWS_S3_BUCKET,
        },
        {
          priority: 1,
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
    } catch (queueError) {
      console.warn("Failed to queue virus scan for document:", queueError);
    }

    // Log audit event
    await logAuditEventNonBlocking({
      category: "SENSITIVE_ACCESS",
      action: "DOCUMENT_UPLOAD",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: session.user.id,
      projectId,
      resourceType: "document",
      resourceId: document.id,
      description: `Supporting document uploaded: ${documentType}`,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        documentType,
      },
      ...requestContext,
    });

    console.log(`✅ Document ${document.id} uploaded. Type: ${documentType}`);

    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        fileName: document.fileName,
        fileSize: document.fileSize,
        documentType: document.documentType,
        virusScanStatus: document.virusScanStatus,
        reviewStatus: document.reviewStatus,
        createdAt: document.createdAt,
      },
      message: "Document uploaded successfully! Virus scan in progress...",
    });
  } catch (err) {
    console.error("Document upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
