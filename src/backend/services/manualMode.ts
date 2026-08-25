/**
 * P3-B1: Full manual mode workflow. Lets staff complete a project end-to-end
 * without the AI pipeline — modification type/scope/pricing are entered
 * directly, drawings/vendor quotes are attached as Documents, and the output
 * package (quote, grant document, BuilderTrend work order) is generated from
 * that manually-entered data.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, ProjectAccessRole, ProjectStatus, type ManualModeSubmissionStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { uploadToS3, S3_BUCKET } from "lib/s3";
import { virusScanQueue } from "@/backend/queue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { generateAndStoreGrantDocument } from "@/backend/services/grantDocument";
import { enqueueBuilderTrendTransfer } from "@/backend/integrations/buildertrend";
import {
  BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION,
  toNumber,
  type BuilderTrendWorkOrderPayload,
} from "@/backend/integrations/builderTrendPayload";
import { markEstimateReadyForReview } from "@/backend/services/estimateReadyTransition";
import { ESTIMATE_READY_TRIGGER_SOURCE } from "@/backend/notifications/estimateReadyContract";
import { deriveAddressFromIntakeData } from "@/backend/services/intakeDraft";
import { provinces } from "@/backend/schemas/intakeDraft";

export type ManualModeErrorCode =
  | "PROJECT_NOT_FOUND"
  | "INVALID_MODIFICATION_TYPE"
  | "INVALID_SCOPE"
  | "INVALID_PRICING_ITEMS"
  | "INVALID_DOCUMENT_TYPE"
  | "SUBMISSION_NOT_FOUND"
  | "SUBMISSION_NOT_READY"
  | "SUBMISSION_LOCKED"
  | "CLIENT_NOT_FOUND"
  | "INVALID_ADDRESS"
  | "INVALID_FILE_TYPE";

export class ManualModeError extends Error {
  statusCode: number;
  code: ManualModeErrorCode;

  constructor(message: string, statusCode: number, code: ManualModeErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ManualPricingItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

function roundToCents(value: number): number {
  return Number(value.toFixed(2));
}

function validatePricingItems(input: unknown): ManualPricingItem[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ManualModeError("pricingItems must be a non-empty array", 400, "INVALID_PRICING_ITEMS");
  }

  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new ManualModeError(`pricingItems[${index}] must be an object`, 400, "INVALID_PRICING_ITEMS");
    }

    const { description, quantity, unitPrice } = raw as Record<string, unknown>;

    if (typeof description !== "string" || !description.trim()) {
      throw new ManualModeError(
        `pricingItems[${index}].description must be a non-empty string`,
        400,
        "INVALID_PRICING_ITEMS"
      );
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      throw new ManualModeError(
        `pricingItems[${index}].quantity must be a positive number`,
        400,
        "INVALID_PRICING_ITEMS"
      );
    }
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ManualModeError(
        `pricingItems[${index}].unitPrice must be a non-negative number`,
        400,
        "INVALID_PRICING_ITEMS"
      );
    }

    return { description: description.trim(), quantity, unitPrice };
  });
}

function computePricingTotal(items: ManualPricingItem[]): number {
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return roundToCents(total);
}

export interface UpsertManualModeSubmissionInput {
  projectId: string;
  actorUserId: string;
  modificationType: unknown;
  scope: unknown;
  pricingItems: unknown;
  notes?: unknown;
  markReady?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ManualModeSubmissionResult {
  id: string;
  projectId: string;
  modificationType: string;
  scope: string;
  pricingItems: ManualPricingItem[];
  subtotal: number;
  total: number;
  notes: string | null;
  status: ManualModeSubmissionStatus;
}

export async function upsertManualModeSubmission(
  input: UpsertManualModeSubmissionInput
): Promise<ManualModeSubmissionResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, manualModeSubmission: { select: { id: true, status: true } } },
  });

  if (!project) {
    throw new ManualModeError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  if (project.manualModeSubmission?.status === "PACKAGE_GENERATED") {
    throw new ManualModeError(
      "This project's output package has already been generated and can no longer be edited.",
      409,
      "SUBMISSION_LOCKED"
    );
  }

  if (typeof input.modificationType !== "string" || !input.modificationType.trim()) {
    throw new ManualModeError("modificationType must be a non-empty string", 400, "INVALID_MODIFICATION_TYPE");
  }
  if (typeof input.scope !== "string" || !input.scope.trim()) {
    throw new ManualModeError("scope must be a non-empty string", 400, "INVALID_SCOPE");
  }

  const pricingItems = validatePricingItems(input.pricingItems);
  const total = computePricingTotal(pricingItems);
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
  const status: ManualModeSubmissionStatus = input.markReady ? "READY" : "DRAFT";
  const isNewSubmission = !project.manualModeSubmission;

  const submission = await prisma.manualModeSubmission.upsert({
    where: { projectId: project.id },
    create: {
      projectId: project.id,
      modificationType: input.modificationType.trim(),
      scope: input.scope.trim(),
      pricingItems: pricingItems as unknown as Prisma.InputJsonValue,
      subtotal: new Prisma.Decimal(total),
      total: new Prisma.Decimal(total),
      notes,
      status,
      enteredByUserId: input.actorUserId,
    },
    update: {
      modificationType: input.modificationType.trim(),
      scope: input.scope.trim(),
      pricingItems: pricingItems as unknown as Prisma.InputJsonValue,
      subtotal: new Prisma.Decimal(total),
      total: new Prisma.Decimal(total),
      notes,
      status,
      enteredByUserId: input.actorUserId,
    },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { isManualMode: true },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MANUAL_MODE_SUBMISSION_SAVED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "manual_mode_submission",
    resourceId: submission.id,
    description: `Manual mode submission ${isNewSubmission ? "created" : "updated"} (status: ${status})`,
    afterState: {
      modificationType: submission.modificationType,
      scope: submission.scope,
      pricingItemCount: pricingItems.length,
      total,
      status,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    id: submission.id,
    projectId: submission.projectId,
    modificationType: submission.modificationType,
    scope: submission.scope,
    pricingItems,
    subtotal: total,
    total,
    notes: submission.notes,
    status: submission.status,
  };
}

export async function getManualModeSubmission(projectId: string): Promise<ManualModeSubmissionResult | null> {
  const submission = await prisma.manualModeSubmission.findUnique({ where: { projectId } });
  if (!submission) return null;

  return {
    id: submission.id,
    projectId: submission.projectId,
    modificationType: submission.modificationType,
    scope: submission.scope,
    pricingItems: (submission.pricingItems as unknown as ManualPricingItem[]) ?? [],
    subtotal: submission.subtotal.toNumber(),
    total: submission.total.toNumber(),
    notes: submission.notes,
    status: submission.status,
  };
}

const MANUAL_MODE_DOCUMENT_TYPES = ["MANUAL_MODE_DRAWING", "VENDOR_QUOTE"] as const;
type ManualModeDocumentType = (typeof MANUAL_MODE_DOCUMENT_TYPES)[number];

export interface AttachManualModeDocumentInput {
  projectId: string;
  actorUserId: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  buffer: Buffer;
  label?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ManualModeDocumentResult {
  id: string;
  fileName: string;
  documentType: string;
  s3Url: string;
  virusScanStatus: string;
  createdAt: Date;
}

function isManualModeDocumentType(value: string): value is ManualModeDocumentType {
  return (MANUAL_MODE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export async function attachManualModeDocument(
  input: AttachManualModeDocumentInput
): Promise<ManualModeDocumentResult> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) {
    throw new ManualModeError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  if (!isManualModeDocumentType(input.documentType)) {
    throw new ManualModeError(
      "documentType must be MANUAL_MODE_DRAWING or VENDOR_QUOTE",
      400,
      "INVALID_DOCUMENT_TYPE"
    );
  }

  const timestamp = Date.now();
  const randomId = randomUUID().slice(0, 8);
  const extension = input.fileName.split(".").pop() || "bin";
  const folder = input.documentType === "MANUAL_MODE_DRAWING" ? "manual-mode/drawings" : "manual-mode/vendor-quotes";
  const s3Key = `projects/${project.id}/${folder}/${timestamp}-${randomId}.${extension}`;
  const s3Url = await uploadToS3(input.buffer, s3Key, input.mimeType);

  const document = await prisma.document.create({
    data: {
      projectId: project.id,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      s3Key,
      s3Url,
      documentType: input.documentType,
      label: input.label ?? null,
      virusScanStatus: "pending",
      uploadedByUserId: input.actorUserId,
    },
  });

  try {
    await virusScanQueue.add(
      `scan-doc-${document.id}`,
      {
        key: s3Key,
        photoId: document.id, // reuse photoId field; worker handles both photo and document scans
        bucket: S3_BUCKET,
      },
      { priority: 1, removeOnComplete: 100, removeOnFail: 500 }
    );
  } catch (queueError) {
    console.warn("Failed to queue virus scan for manual mode document:", queueError);
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MANUAL_MODE_DOCUMENT_ATTACHED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "document",
    resourceId: document.id,
    description: `Manual mode ${input.documentType === "MANUAL_MODE_DRAWING" ? "drawing" : "vendor quote"} attached`,
    metadata: {
      fileName: input.fileName,
      fileSize: input.fileSize,
      documentType: input.documentType,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    id: document.id,
    fileName: document.fileName,
    documentType: document.documentType,
    s3Url: document.s3Url,
    virusScanStatus: document.virusScanStatus,
    createdAt: document.createdAt,
  };
}

export interface AttachManualModePhotoInput {
  projectId: string;
  actorUserId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ManualModePhotoResult {
  id: string;
  url: string;
  virusScanStatus: string;
  createdAt: Date;
}

const MANUAL_MODE_PHOTO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Attaches a reference photo to a manual-mode project. These are staff
 * uploads for visual reference only — isManualMode already short-circuits
 * the AI photo-analysis/image-generation pipeline for this project's
 * photos (see virusScanWorker.ts), so no AI jobs are ever queued here.
 */
export async function attachManualModePhoto(
  input: AttachManualModePhotoInput
): Promise<ManualModePhotoResult> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) {
    throw new ManualModeError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  if (!MANUAL_MODE_PHOTO_ALLOWED_TYPES.includes(input.mimeType)) {
    throw new ManualModeError("Invalid file type. Allowed: JPEG, PNG, WebP.", 400, "INVALID_FILE_TYPE");
  }

  const timestamp = Date.now();
  const randomId = randomUUID().slice(0, 8);
  const extension = input.fileName.split(".").pop() || "jpg";
  const s3Key = `projects/${project.id}/photos/${timestamp}-${randomId}.${extension}`;
  const s3Url = await uploadToS3(input.buffer, s3Key, input.mimeType);

  const photo = await prisma.photo.create({
    data: {
      url: s3Url,
      projectId: project.id,
      virus_scan_status: "pending",
    },
  });

  try {
    await virusScanQueue.add(
      `scan-${photo.id}`,
      { key: s3Key, photoId: photo.id, bucket: S3_BUCKET },
      { priority: 1, removeOnComplete: 100, removeOnFail: 500 }
    );
  } catch (queueError) {
    console.warn("Failed to queue virus scan for manual mode photo:", queueError);
  }

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MANUAL_MODE_PHOTO_ATTACHED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "photo",
    resourceId: photo.id,
    description: "Manual mode reference photo attached",
    metadata: { fileName: input.fileName },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    id: photo.id,
    url: photo.url,
    virusScanStatus: photo.virus_scan_status,
    createdAt: photo.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Create-from-scratch: admin starts a brand-new project for a client, */
/* decoupled from any client-initiated intake.                         */
/* ------------------------------------------------------------------ */

export interface ClientSearchResult {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** Searches registered clients by name/email for the Manual Mode project-creation picker. */
export async function searchClientUsers(query: string): Promise<ClientSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { email: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { email: "asc" },
    take: 10,
  });
}

const manualModeProjectAddressSchema = z
  .object({
    addressLine1: z.string().min(1, "Street address is required").max(200),
    addressLine2: z.string().max(50).optional().or(z.literal("")),
    city: z.string().min(1, "City is required").max(100),
    province: z.enum(provinces, { message: "Province is required" }),
    postalCode: z
      .string()
      .min(1, "Postal code is required")
      .max(10, "Postal code is too long")
      .regex(/^[A-Za-z0-9 ]+$/, "Postal code can only contain letters, numbers, and spaces"),
    ownershipStatus: z.enum(["owner", "tenant", "other"], {
      message: "Please select owner, tenant, or other",
    }),
    ownershipOtherDetails: z.string().max(200).optional().or(z.literal("")),
    landlordName: z.string().max(120).optional().or(z.literal("")),
    landlordPhone: z
      .string()
      .regex(/^[\d\s\-+()]*$/, "Phone can only contain digits and + - ( )")
      .max(24, "Phone number is too long")
      .optional()
      .or(z.literal("")),
    urgency: z.enum(["immediate", "soon", "planning", "just exploring"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ownershipStatus === "tenant" && !data.landlordName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["landlordName"], message: "Landlord name is required for tenants" });
    }
    if (data.ownershipStatus === "other" && !data.ownershipOtherDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownershipOtherDetails"],
        message: "Please explain the ownership status",
      });
    }
  });

export interface CreateManualModeProjectInput {
  clientUserId: string;
  actorUserId: string;
  address: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateManualModeProjectResult {
  projectId: string;
}

/** Admin creates a brand-new project from scratch for an existing client, entering Manual Mode immediately. */
export async function createManualModeProject(
  input: CreateManualModeProjectInput
): Promise<CreateManualModeProjectResult> {
  const client = await prisma.user.findUnique({ where: { id: input.clientUserId }, select: { id: true } });
  if (!client) {
    throw new ManualModeError("Selected client not found", 404, "CLIENT_NOT_FOUND");
  }

  const parsed = manualModeProjectAddressSchema.safeParse(input.address);
  if (!parsed.success) {
    throw new ManualModeError(parsed.error.issues[0]?.message ?? "Invalid address details", 400, "INVALID_ADDRESS");
  }
  const addressData = parsed.data;

  const address = deriveAddressFromIntakeData({
    addressLine1: addressData.addressLine1,
    city: addressData.city,
    province: addressData.province,
    postalCode: addressData.postalCode,
  });

  const draftData = {
    addressLine1: addressData.addressLine1,
    addressLine2: addressData.addressLine2 || "",
    city: addressData.city,
    province: addressData.province,
    postalCode: addressData.postalCode,
    ownershipStatus: addressData.ownershipStatus,
    ownershipOtherDetails: addressData.ownershipOtherDetails || "",
    landlordName: addressData.landlordName || "",
    landlordPhone: addressData.landlordPhone || "",
    urgency: addressData.urgency ?? null,
  } satisfies Prisma.InputJsonValue;

  const project = await prisma.project.create({
    data: {
      address,
      status: ProjectStatus.DRAFT,
      userId: client.id,
      isManualMode: true,
      draftData,
      projectAccess: {
        create: {
          userId: client.id,
          role: ProjectAccessRole.OWNER,
          grantedByUserId: input.actorUserId,
        },
      },
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: ProjectStatus.DRAFT,
          changedByUserId: input.actorUserId,
          metadata: { source: "admin_manual_mode_create" } as Prisma.InputJsonValue,
        },
      },
    },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MANUAL_MODE_PROJECT_CREATED",
    outcome: "SUCCESS",
    sensitivityLevel: "CONFIDENTIAL",
    actorUserId: input.actorUserId,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    description: `Admin created project ${project.id} from scratch via Manual Mode for client ${client.id}`,
    afterState: { address, clientUserId: client.id },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { projectId: project.id };
}

export interface GenerateManualOutputPackageInput {
  projectId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface GenerateManualOutputPackageResult {
  projectId: string;
  quoteId: string;
  grantDocumentKey: string | null;
  builderTrendTransferId: string | null;
  clientNotified: boolean;
}

export async function generateManualOutputPackage(
  input: GenerateManualOutputPackageInput
): Promise<GenerateManualOutputPackageResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      address: true,
      user: { select: { name: true, email: true, phone: true } },
      manualModeSubmission: true,
    },
  });

  if (!project) {
    throw new ManualModeError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const submission = project.manualModeSubmission;
  if (!submission) {
    throw new ManualModeError("No manual mode submission exists for this project yet", 404, "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== "READY") {
    throw new ManualModeError(
      `Manual mode submission must be marked READY before generating the output package (current status: ${submission.status})`,
      409,
      "SUBMISSION_NOT_READY"
    );
  }

  // Staff generating the output package is the formal, staff-recorded
  // acceptance for manual mode (no separate client click-through) — so the
  // quote is created already ACCEPTED rather than the default PENDING.
  const quote = await prisma.quote.create({
    data: {
      projectId: project.id,
      subtotal: submission.subtotal,
      total: submission.total,
      estimateMin: submission.total,
      estimateMax: submission.total,
      lastClientActivityAt: new Date(),
      source: "MANUAL",
      status: "ACCEPTED",
      createdByUserId: input.actorUserId,
      manualModeSubmissionId: submission.id,
    },
  });

  let clientNotified = false;
  try {
    const readyResult = await markEstimateReadyForReview({
      projectId: project.id,
      quoteId: quote.id,
      triggerSource: ESTIMATE_READY_TRIGGER_SOURCE.MANUAL_MODE_OUTPUT_PACKAGE,
      actorUserId: input.actorUserId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    clientNotified = readyResult.notified;
  } catch (error) {
    console.warn("Manual mode: estimate-ready notification failed", error);
  }

  let grantDocumentKey: string | null = null;
  try {
    const grantResult = await generateAndStoreGrantDocument({
      projectId: project.id,
      actorUserId: input.actorUserId,
      force: true,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    grantDocumentKey = grantResult.grantDocumentKey;
  } catch (error) {
    console.warn("Manual mode: grant document generation failed", error);
  }

  let builderTrendTransferId: string | null = null;
  try {
    // No photo-declared modification codes or AI-generated refinedEstimate breakdown exist
    // in manual mode (see buildBuilderTrendWorkOrderPayload for that path), so the payload
    // is built directly from the staff-entered submission instead of going through it.
    const builderTrendPayload: BuilderTrendWorkOrderPayload = {
      schemaVersion: BUILDER_TREND_WORK_ORDER_PAYLOAD_SCHEMA_VERSION,
      project: { id: project.id, address: project.address },
      client: {
        name: project.user.name,
        email: project.user.email,
        phone: project.user.phone,
      },
      modificationType: [submission.modificationType],
      totalEstimate: toNumber(quote.total),
    };

    const transfer = await prisma.builderTrendTransfer.create({
      data: {
        projectId: project.id,
        quoteId: quote.id,
        status: "PENDING",
        payload: builderTrendPayload as unknown as Prisma.InputJsonValue,
      },
    });
    builderTrendTransferId = transfer.id;

    // Approval gate (Ticket 1): only enqueue immediately if the project
    // is already APPROVED by the time staff generate the output package. If
    // approval comes later, projectStatusLifecycle.ts's
    // transitionProjectStatus enqueues it at that point instead — the
    // two triggers race independently. Reads status fresh, right
    // here after the transfer row above has committed, rather than reusing the
    // `project` fetched at function entry: real async work (markEstimateReadyForReview,
    // generateAndStoreGrantDocument) already ran in between, so that snapshot could be
    // stale by the time we get here, and a concurrent approval landing in that window
    // could otherwise race both triggers into missing each other (the approval side's
    // own lookup would find no transfer row yet, and this side would see a stale
    // "not approved" status) — leaving the transfer stuck PENDING forever. A fresh
    // read taken after our own commit closes that window: whichever side's write
    // lands first, the other side's later read is guaranteed to observe it.
    const currentProject = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true },
    });

    if (currentProject?.status === "APPROVED") {
      await enqueueBuilderTrendTransfer(transfer.id);
    }
  } catch (error) {
    console.warn("Manual mode: BuilderTrend transfer creation/enqueue failed", error);
  }

  await prisma.manualModeSubmission.update({
    where: { id: submission.id },
    data: { status: "PACKAGE_GENERATED" },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MANUAL_MODE_OUTPUT_PACKAGE_GENERATED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId,
    projectId: project.id,
    quoteId: quote.id,
    resourceType: "manual_mode_submission",
    resourceId: submission.id,
    description: "Manual mode output package generated (quote, grant document, BuilderTrend work order)",
    afterState: {
      quoteId: quote.id,
      grantDocumentKey,
      builderTrendTransferId,
      clientNotified,
      acceptanceRecordedBy: "STAFF",
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    projectId: project.id,
    quoteId: quote.id,
    grantDocumentKey,
    builderTrendTransferId,
    clientNotified,
  };
}
