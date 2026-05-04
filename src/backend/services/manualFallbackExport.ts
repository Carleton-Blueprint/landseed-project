import { randomUUID } from "node:crypto";
import { manualFallbackExportQueue } from "@/backend/queue";

export const MANUAL_FALLBACK_EXPORT_QUEUE_NAME = "manual-fallback-export" as const;
export const MANUAL_FALLBACK_EXPORT_ROOT_PREFIX = "manual-fallback-exports" as const;
export const DEFAULT_MANUAL_FALLBACK_EXPORT_RETENTION_DAYS = 7;
export const MANUAL_FALLBACK_EXPORT_RETENTION_DAYS_ENV = "MANUAL_FALLBACK_EXPORT_RETENTION_DAYS";
export const MANUAL_FALLBACK_EXPORT_MAX_BYTES_ENV = "MANUAL_FALLBACK_EXPORT_MAX_SIZE_BYTES";

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

export interface ManualFallbackExportQueuedRequest extends ManualFallbackExportRequest {
  exportRequestId: string;
  requestedAt: string;
  retentionDays: number;
  maxSizeBytes?: number;
}

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

export function getManualFallbackExportSettings(): ManualFallbackExportSettings {
  const retentionDays =
    parsePositiveIntegerEnv(process.env[MANUAL_FALLBACK_EXPORT_RETENTION_DAYS_ENV]) ??
    DEFAULT_MANUAL_FALLBACK_EXPORT_RETENTION_DAYS;

  return {
    retentionDays,
    maxSizeBytes: parsePositiveIntegerEnv(process.env[MANUAL_FALLBACK_EXPORT_MAX_BYTES_ENV]),
  };
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

export async function processManualFallbackExport(
  request: ManualFallbackExportQueuedRequest
): Promise<ManualFallbackExportArtifact> {
  throw new Error(`Manual fallback export processing is not implemented yet: ${request.exportRequestId}`);
}