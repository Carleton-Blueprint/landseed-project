/**
 * API Route: /api/admin/projects/[projectId]/documents
 * GET: List documents for a project (admin)
 * POST: Upload a document for a project (admin)
 * Auth: NextAuth (admin, MFA-enrolled only)
 */

import type { Session } from "next-auth";
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "lib/prisma";
import { auth } from "@/auth";
import { authGateResponse } from "@/backend/auth/authGateResponse";
import { HttpError } from "@/backend/auth/requireRole";
import { MfaSetupRequiredError, requireAdminWithMfaEnrolled } from "@/backend/auth/requireAdminMfa";
import { getRequestAuditContext } from "@/backend/audit/requestContext";
import { logDeniedAdminAccessAttempt } from "@/backend/audit/adminAccess";
import { uploadToS3, S3_BUCKET } from "lib/s3";
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

async function requireAdminForProjectDocuments(
  request: Request,
  session: Session | null,
  projectId: string
): Promise<Response | null> {
  try {
    await requireAdminWithMfaEnrolled(session);
    return null;
  } catch (error) {
    if (error instanceof HttpError || error instanceof MfaSetupRequiredError) {
      const auditContext = getRequestAuditContext(request);
      await logDeniedAdminAccessAttempt({
        surface: "route",
        actorUserId: session?.user?.id ?? null,
        routePath: new URL(request.url).pathname,
        method: request.method,
        resourceType: "Document",
        resourceId: projectId,
        projectId,
        reason: error.message,
        description: "Denied access to project documents route",
        ...auditContext,
        metadata: {
          source: "route-handler",
          requiredRole: "ADMIN",
        },
      });

      return authGateResponse(error) ?? Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: "forbidden" }, { status: 403 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const session = await auth();
    const denied = await requireAdminForProjectDocuments(request, session, projectId);
    if (denied) return denied;

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
    const denied = await requireAdminForProjectDocuments(request, session, projectId);
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");
    const documentType = formData.get("documentType") as DocumentType;
    const isClientVisible = formData.get("isClientVisible") !== "false";

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
        bucket: S3_BUCKET,
      });
    } catch (qErr) {
      console.error("Failed to enqueue virus scan:", qErr);
    }

    return NextResponse.json({ document, message: "Document uploaded successfully!" }, { status: 201 });
  } catch (error) {
    console.error("Error uploading admin document:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
