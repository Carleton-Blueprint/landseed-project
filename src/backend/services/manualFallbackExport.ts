import archiver from "archiver";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { NotificationEventType, ManualFallbackExportStatus } from "@prisma/client";
import { manualFallbackExportQueue } from "@/backend/queue";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";
import { deleteObjectFromS3, getSignedDownloadUrlFromS3Url, getSignedDownloadUrl, uploadStreamToS3 } from "lib/s3";

export const MANUAL_FALLBACK_EXPORT_QUEUE_NAME = "manual-fallback-export" as const;
export const MANUAL_FALLBACK_EXPORT_ROOT_PREFIX = "manual-fallback-exports" as const;
export const DEFAULT_MANUAL_FALLBACK_EXPORT_RETENTION_DAYS = 7;
export const MANUAL_FALLBACK_EXPORT_RETENTION_DAYS_ENV = "MANUAL_FALLBACK_EXPORT_RETENTION_DAYS";
export const MANUAL_FALLBACK_EXPORT_MAX_BYTES_ENV = "MANUAL_FALLBACK_EXPORT_MAX_SIZE_BYTES";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface ManualFallbackExportRequest {
  projectId: string;
  requestedByUserId: string;
  requestedByEmail?: string | null;
  requestedByName?: string | null;
}

export interface ManualFallbackExportSettings {
  retentionDays: number;
  maxSizeBytes?: number;
}

export interface ManualFallbackExportArtifact {
  exportRequestId: string;
  projectId: string;
  archiveFileName: string;
  s3ObjectKey: string;
  retentionDays: number;
  maxSizeBytes?: number;
}

export interface ManualFallbackExportCleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
  exportIds: string[];
}

export interface ManualFallbackExportQueuedRequest extends ManualFallbackExportRequest {
  exportRequestId: string;
  requestedAt: string;
  retentionDays: number;
  maxSizeBytes?: number;
}

type ManualFallbackProjectSnapshot = {
  id: string;
  address: string;
  status: string;
  grantApplicationStatus: string;
  grantDocumentKey: string | null;
  draftData: unknown;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  quotes: Array<{
    id: string;
    status: string;
    subtotal: { toString: () => string };
    total: { toString: () => string };
    estimateMin: { toString: () => string } | null;
    estimateMax: { toString: () => string } | null;
    refinedEstimate: unknown;
    generatedAt: Date;
    lastClientActivityAt: Date;
    declinedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  photos: Array<{
    id: string;
    url: string;
    virus_scan_status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  grantApplicationStatusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    changedAt: Date;
    changedByUserId: string;
    reason: string | null;
    metadata: unknown;
  }>;
};

type ExportByteTracker = {
  totalBytes: number;
  maxBytes?: number;
};

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function decimalToString(value: { toString: () => string } | null): string | null {
  return value ? value.toString() : null;
}

function sanitizeArchiveEntryName(name: string): string {
  return name.replace(/[\\/\0<>:"|?*]+/g, "-").replace(/\s+/g, "-");
}

function encodeJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function trackExportBytes(tracker: ExportByteTracker, byteCount: number, label: string): void {
  tracker.totalBytes += byteCount;

  if (tracker.maxBytes != null && tracker.totalBytes > tracker.maxBytes) {
    throw new Error(`Manual fallback export exceeded the configured size limit after ${label}`);
  }
}

async function fetchBufferFromUrl(
  url: string,
  label: string,
  tracker: ExportByteTracker
): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${label} (${response.status} ${response.statusText})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  trackExportBytes(tracker, buffer.length, label);
  return buffer;
}

async function appendJsonEntry(
  archive: archiver.Archiver,
  name: string,
  value: unknown,
  tracker?: ExportByteTracker
): Promise<void> {
  const buffer = encodeJson(value);
  if (tracker) {
    trackExportBytes(tracker, buffer.length, name);
  }

  archive.append(buffer, { name });
}

async function uploadArchiveToS3(archive: archiver.Archiver, s3Key: string): Promise<string> {
  const output = new PassThrough();
  const uploadPromise = uploadStreamToS3(output, s3Key, "application/zip");

  const archiveCompletion = new Promise<void>((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.finalize();

  await Promise.all([uploadPromise, archiveCompletion]);
  return uploadPromise;
}

function getManualFallbackExportSettings(): ManualFallbackExportSettings {
  const retentionDays =
    parsePositiveIntegerEnv(process.env[MANUAL_FALLBACK_EXPORT_RETENTION_DAYS_ENV]) ??
    DEFAULT_MANUAL_FALLBACK_EXPORT_RETENTION_DAYS;

  return {
    retentionDays,
    maxSizeBytes: parsePositiveIntegerEnv(process.env[MANUAL_FALLBACK_EXPORT_MAX_BYTES_ENV]),
  };
}

function buildManualFallbackExportDownloadLink(projectId: string, exportRequestId: string): string {
  const baseUrl = process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/project/${projectId}/manual-fallback-export/${exportRequestId}/download`;
}

export function buildManualFallbackExportRequestId(): string {
  return `manual-fallback-export-${randomUUID()}`;
}

export function buildManualFallbackExportArchiveFileName(
  projectId: string,
  exportRequestId: string
): string {
  return `project-${projectId}-fallback-export-${exportRequestId}.zip`;
}

export function buildManualFallbackExportS3ObjectKey(
  projectId: string,
  exportRequestId: string
): string {
  return `${MANUAL_FALLBACK_EXPORT_ROOT_PREFIX}/${projectId}/${exportRequestId}.zip`;
}

export async function requestManualFallbackExport(
  input: ManualFallbackExportRequest
): Promise<ManualFallbackExportQueuedRequest> {
  const settings = getManualFallbackExportSettings();
  const exportRequestId = buildManualFallbackExportRequestId();
  const requestedAt = new Date().toISOString();

  await manualFallbackExportQueue.add(
    `manual-fallback-export:${exportRequestId}`,
    {
      exportRequestId,
      projectId: input.projectId,
      requestedByUserId: input.requestedByUserId,
      requestedByEmail: input.requestedByEmail ?? null,
      requestedByName: input.requestedByName ?? null,
      requestedAt,
      retentionDays: settings.retentionDays,
      maxSizeBytes: settings.maxSizeBytes,
    },
    {
      jobId: exportRequestId,
      removeOnComplete: 100,
      removeOnFail: 500,
      priority: 1,
    }
  );

  return {
    ...input,
    exportRequestId,
    requestedAt,
    retentionDays: settings.retentionDays,
    maxSizeBytes: settings.maxSizeBytes,
  };
}

async function sendManualFallbackExportNotification(
  project: ManualFallbackProjectSnapshot,
  exportRecord: {
    id: string;
    retentionDays: number;
    requestedByEmail: string | null;
    requestedByName: string | null;
    s3Key: string | null;
    expiresAt: Date | null;
  },
  requestedByUserId: string
): Promise<void> {
  if (!project.user.email && !exportRecord.requestedByEmail) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MANUAL_FALLBACK_EXPORT_NOTIFICATION_SKIPPED",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: requestedByUserId,
      projectId: project.id,
      resourceType: "manual_fallback_export",
      resourceId: exportRecord.id,
      description: "Manual fallback export notification skipped because no recipient email was available",
      metadata: {
        retentionDays: exportRecord.retentionDays,
      },
    });
    return;
  }

  const recipientEmail = project.user.email ?? exportRecord.requestedByEmail ?? "";
  const recipientName = project.user.name ?? exportRecord.requestedByName;
  const downloadLink = buildManualFallbackExportDownloadLink(project.id, exportRecord.id);

  await enqueueNotification({
    eventType: NotificationEventType.MANUAL_FALLBACK_EXPORT_READY,
    idempotencyKey: `manual-fallback-export-ready:${exportRecord.id}`,
    recipientEmail,
    recipientName,
    userId: project.user.id,
    projectId: project.id,
    projectAddress: project.address,
    manualFallbackExportLink: downloadLink,
    manualFallbackExportRetentionDays: exportRecord.retentionDays,
  });
}

function buildQuoteSnapshot(quote: ManualFallbackProjectSnapshot["quotes"][number]) {
  return {
    id: quote.id,
    status: quote.status,
    subtotal: quote.subtotal.toString(),
    total: quote.total.toString(),
    estimateMin: decimalToString(quote.estimateMin),
    estimateMax: decimalToString(quote.estimateMax),
    refinedEstimate: quote.refinedEstimate,
    generatedAt: quote.generatedAt.toISOString(),
    lastClientActivityAt: quote.lastClientActivityAt.toISOString(),
    declinedReason: quote.declinedReason,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}

function buildPhotoSnapshot(photo: ManualFallbackProjectSnapshot["photos"][number]) {
  const url = new URL(photo.url);
  const originalFileName = sanitizeArchiveEntryName(decodeURIComponent(url.pathname.split("/").pop() ?? photo.id));

  return {
    id: photo.id,
    url: photo.url,
    fileName: originalFileName,
    virusScanStatus: photo.virus_scan_status,
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
  };
}

async function buildArchiveForProject(
  project: ManualFallbackProjectSnapshot,
  exportRequestId: string,
  settings: ManualFallbackExportSettings
): Promise<{ fileName: string; s3Key: string }> {
  const tracker: ExportByteTracker = { totalBytes: 0, maxBytes: settings.maxSizeBytes };
  const archive = archiver("zip", { zlib: { level: 9 } });
  const fileName = buildManualFallbackExportArchiveFileName(project.id, exportRequestId);
  const s3Key = buildManualFallbackExportS3ObjectKey(project.id, exportRequestId);

  await appendJsonEntry(
    archive,
    "manifest.json",
    {
      exportRequestId,
      projectId: project.id,
      projectAddress: project.address,
      requestedAt: new Date().toISOString(),
      retentionDays: settings.retentionDays,
      maxSizeBytes: settings.maxSizeBytes ?? null,
      counts: {
        quotes: project.quotes.length,
        photos: project.photos.length,
        grantHistoryEntries: project.grantApplicationStatusHistory.length,
      },
      generatedAt: new Date().toISOString(),
    },
    tracker
  );

  await appendJsonEntry(
    archive,
    "project.json",
    {
      id: project.id,
      address: project.address,
      status: project.status,
      grantApplicationStatus: project.grantApplicationStatus,
      grantDocumentKey: project.grantDocumentKey,
      draftData: project.draftData,
      owner: {
        id: project.user.id,
        name: project.user.name,
        email: project.user.email,
      },
    },
    tracker
  );

  await appendJsonEntry(
    archive,
    "quotes.json",
    project.quotes.map(buildQuoteSnapshot),
    tracker
  );

  await appendJsonEntry(
    archive,
    "photos.json",
    project.photos.map(buildPhotoSnapshot),
    tracker
  );

  await appendJsonEntry(
    archive,
    "grants.json",
    {
      grantApplicationStatus: project.grantApplicationStatus,
      grantDocumentKey: project.grantDocumentKey,
      grantApplicationStatusHistory: project.grantApplicationStatusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedAt: entry.changedAt.toISOString(),
        changedByUserId: entry.changedByUserId,
        reason: entry.reason,
        metadata: entry.metadata,
      })),
      },
    tracker
  );

  if (project.grantDocumentKey) {
    const grantDocumentUrl = await getSignedDownloadUrl(project.grantDocumentKey, 3600);
    const grantDocumentBuffer = await fetchBufferFromUrl(grantDocumentUrl, "grant document", tracker);
    archive.append(grantDocumentBuffer, { name: "grant-application.pdf" });
  }

  for (const quote of project.quotes) {
    const quoteFileName = `quote-${quote.id}.json`;
    const quoteBuffer = encodeJson(buildQuoteSnapshot(quote));
    trackExportBytes(tracker, quoteBuffer.length, quoteFileName);
    archive.append(quoteBuffer, { name: quoteFileName });
  }

  for (const photo of project.photos) {
    const photoSnapshot = buildPhotoSnapshot(photo);
    const signedUrl = await getSignedDownloadUrlFromS3Url(photo.url, 3600);
    const photoBuffer = await fetchBufferFromUrl(signedUrl, `photo ${photo.id}`, tracker);
    const entryName = `${photo.id}-${photoSnapshot.fileName}`;
    archive.append(photoBuffer, { name: entryName });
  }

  const uploadPromise = uploadArchiveToS3(archive, s3Key);

  return uploadPromise.then(() => ({ fileName, s3Key }));
}

export async function processManualFallbackExport(
  request: ManualFallbackExportQueuedRequest
): Promise<ManualFallbackExportArtifact> {
  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
    select: {
      id: true,
      address: true,
      status: true,
      grantApplicationStatus: true,
      grantDocumentKey: true,
      draftData: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      quotes: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          status: true,
          subtotal: true,
          total: true,
          estimateMin: true,
          estimateMax: true,
          refinedEstimate: true,
          generatedAt: true,
          lastClientActivityAt: true,
          declinedReason: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      photos: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          url: true,
          virus_scan_status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      grantApplicationStatusHistory: {
        orderBy: [{ changedAt: "asc" }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          changedAt: true,
          changedByUserId: true,
          reason: true,
          metadata: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error(`Project not found: ${request.projectId}`);
  }

  const existingExport = await prisma.manualFallbackExport.findUnique({
    where: { id: request.exportRequestId },
  });

  if (existingExport?.status === ManualFallbackExportStatus.READY && existingExport.s3Key && existingExport.fileName) {
    await sendManualFallbackExportNotification(project, existingExport, request.requestedByUserId);

    return {
      exportRequestId: existingExport.id,
      projectId: project.id,
      archiveFileName: existingExport.fileName,
      s3ObjectKey: existingExport.s3Key,
      retentionDays: existingExport.retentionDays,
      maxSizeBytes: existingExport.maxSizeBytes ?? undefined,
    };
  }

  const exportRecord = await prisma.manualFallbackExport.upsert({
    where: { id: request.exportRequestId },
    create: {
      id: request.exportRequestId,
      projectId: request.projectId,
      requestedByUserId: request.requestedByUserId,
      requestedByEmail: request.requestedByEmail ?? null,
      requestedByName: request.requestedByName ?? null,
      status: ManualFallbackExportStatus.PENDING,
      retentionDays: request.retentionDays,
      maxSizeBytes: request.maxSizeBytes ?? null,
      requestedAt: new Date(request.requestedAt),
    },
    update: {
      projectId: request.projectId,
      requestedByUserId: request.requestedByUserId,
      requestedByEmail: request.requestedByEmail ?? null,
      requestedByName: request.requestedByName ?? null,
      status: ManualFallbackExportStatus.PENDING,
      retentionDays: request.retentionDays,
      maxSizeBytes: request.maxSizeBytes ?? null,
      lastError: null,
      readyAt: null,
      expiresAt: null,
    },
  });

  const startedAt = new Date();

  try {
    const { fileName, s3Key } = await buildArchiveForProject(project, exportRecord.id, {
      retentionDays: exportRecord.retentionDays,
      maxSizeBytes: exportRecord.maxSizeBytes ?? undefined,
    });

    const readyAt = new Date();
    const expiresAt = new Date(readyAt.getTime() + exportRecord.retentionDays * DAY_IN_MS);

    const readyExport = await prisma.manualFallbackExport.update({
      where: { id: exportRecord.id },
      data: {
        status: ManualFallbackExportStatus.READY,
        s3Key,
        fileName,
        readyAt,
        expiresAt,
        lastError: null,
      },
    });

    await sendManualFallbackExportNotification(project, readyExport, request.requestedByUserId);

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MANUAL_FALLBACK_EXPORT_READY",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: request.requestedByUserId,
      projectId: project.id,
      resourceType: "manual_fallback_export",
      resourceId: exportRecord.id,
      description: "Manual fallback export processed successfully",
      metadata: {
        retentionDays: readyExport.retentionDays,
        maxSizeBytes: readyExport.maxSizeBytes ?? null,
        durationMs: readyAt.getTime() - startedAt.getTime(),
        fileName,
        s3Key,
      },
    });

    return {
      exportRequestId: readyExport.id,
      projectId: project.id,
      archiveFileName: fileName,
      s3ObjectKey: s3Key,
      retentionDays: readyExport.retentionDays,
      maxSizeBytes: readyExport.maxSizeBytes ?? undefined,
    };
  } catch (error) {
    await prisma.manualFallbackExport.update({
      where: { id: exportRecord.id },
      data: {
        status: ManualFallbackExportStatus.FAILED,
        lastError: error instanceof Error ? error.message : "Unknown manual fallback export error",
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MANUAL_FALLBACK_EXPORT_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: request.requestedByUserId,
      projectId: project.id,
      resourceType: "manual_fallback_export",
      resourceId: exportRecord.id,
      description: "Manual fallback export processing failed",
      metadata: {
        errorMessage: error instanceof Error ? error.message : "Unknown manual fallback export error",
      },
    });

    throw error;
  }
}

export async function cleanupExpiredManualFallbackExports(
  now: Date = new Date()
): Promise<ManualFallbackExportCleanupResult> {
  const expiredExports = await prisma.manualFallbackExport.findMany({
    where: {
      status: ManualFallbackExportStatus.READY,
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      projectId: true,
      s3Key: true,
      fileName: true,
      requestedByUserId: true,
    },
    orderBy: { expiresAt: "asc" },
  });

  let deleted = 0;
  let failed = 0;

  for (const exportRecord of expiredExports) {
    try {
      if (exportRecord.s3Key) {
        await deleteObjectFromS3(exportRecord.s3Key);
      }

      await prisma.manualFallbackExport.delete({ where: { id: exportRecord.id } });

      deleted += 1;

      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "MANUAL_FALLBACK_EXPORT_EXPIRED",
        outcome: "SUCCESS",
        sensitivityLevel: "RESTRICTED",
        actorUserId: exportRecord.requestedByUserId,
        projectId: exportRecord.projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRecord.id,
        description: "Expired manual fallback export removed from storage and database",
        metadata: {
          fileName: exportRecord.fileName,
          s3Key: exportRecord.s3Key,
          expiredAt: now.toISOString(),
        },
      });
    } catch (error) {
      failed += 1;

      await logAuditEventNonBlocking({
        category: "MANUAL_CHANGE",
        action: "MANUAL_FALLBACK_EXPORT_EXPIRED",
        outcome: "FAILURE",
        sensitivityLevel: "RESTRICTED",
        actorUserId: exportRecord.requestedByUserId,
        projectId: exportRecord.projectId,
        resourceType: "manual_fallback_export",
        resourceId: exportRecord.id,
        description: "Failed to clean up expired manual fallback export",
        metadata: {
          fileName: exportRecord.fileName,
          s3Key: exportRecord.s3Key,
          errorMessage: error instanceof Error ? error.message : "Unknown cleanup error",
        },
      });
    }
  }

  return {
    scanned: expiredExports.length,
    deleted,
    failed,
    exportIds: expiredExports.map((item) => item.id),
  };
}