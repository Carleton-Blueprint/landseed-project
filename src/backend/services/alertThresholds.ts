/**
 * Read/cache layer for admin-editable alert thresholds (AI job, BuilderTrend
 * transfer, email delivery, file scan failures). Rows self-seed with
 * defaults on first read so there's no separate seed-script step — this
 * repo has no seed infrastructure today (see prisma/) — and are then
 * editable via /api/admin/alert-thresholds without a code deploy.
 * Note: the cache is per-process, not distributed — if this ever runs as
 * multiple app/worker instances, a threshold edit in one process won't be
 * visible in the others until their own cache expires. That's why
 * CACHE_TTL_MS is kept short (30s): it bounds how stale a read can be
 * rather than eliminating staleness outright (a cross-process invalidation
 * broadcast would do that, but isn't warranted for a low-frequency admin
 * config value).
 */
import { prisma } from "lib/prisma";
import type { AlertThresholdConfig } from "@prisma/client";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export const ALERT_THRESHOLD_KEYS = {
  AI_JOB_FAILURE: "ai-job-failure",
  BUILDERTREND_TRANSFER_FAILURE: "buildertrend-transfer-failure",
  EMAIL_DELIVERY_FAILURE: "email-delivery-failure",
  FILE_SCAN_FAILURE: "file-scan-failure",
  PRICING_TIER_FALLBACK: "pricing-tier-fallback",
} as const;

export type AlertThresholdKey = (typeof ALERT_THRESHOLD_KEYS)[keyof typeof ALERT_THRESHOLD_KEYS];

const DEFAULTS: Record<AlertThresholdKey, { label: string; thresholdCount: number; windowMinutes: number }> = {
  [ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE]: {
    label: "AI job failures (image generation / photo analysis)",
    thresholdCount: 5,
    windowMinutes: 15,
  },
  [ALERT_THRESHOLD_KEYS.BUILDERTREND_TRANSFER_FAILURE]: {
    label: "BuilderTrend transfer failures",
    thresholdCount: 3,
    windowMinutes: 15,
  },
  [ALERT_THRESHOLD_KEYS.EMAIL_DELIVERY_FAILURE]: {
    label: "Email delivery failures",
    thresholdCount: 5,
    windowMinutes: 15,
  },
  [ALERT_THRESHOLD_KEYS.FILE_SCAN_FAILURE]: {
    label: "File scan failures",
    thresholdCount: 5,
    windowMinutes: 15,
  },
  [ALERT_THRESHOLD_KEYS.PRICING_TIER_FALLBACK]: {
    label: "Quotes falling back to synthetic tier pricing (SERP unusable)",
    thresholdCount: 5,
    windowMinutes: 15,
  },
};

const CACHE_TTL_MS = 30_000;
let cache: { rows: AlertThresholdConfig[]; expiresAt: number } | null = null;

async function ensureSeeded(): Promise<void> {
  const existing = await prisma.alertThresholdConfig.findMany({ select: { key: true } });
  const existingKeys = new Set(existing.map((row) => row.key));
  const missingKeys = (Object.keys(DEFAULTS) as AlertThresholdKey[]).filter(
    (key) => !existingKeys.has(key)
  );

  if (missingKeys.length === 0) {
    return;
  }

  await Promise.all(
    missingKeys.map((key) =>
      prisma.alertThresholdConfig.upsert({
        where: { key },
        create: { key, ...DEFAULTS[key] },
        update: {},
      })
    )
  );
}

/** Invalidates the in-process cache; call after any write. */
export function invalidateAlertThresholdCache(): void {
  cache = null;
}

/** All alert thresholds, seeding defaults for any missing key first. */
export async function getAllAlertThresholds(): Promise<AlertThresholdConfig[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.rows;
  }

  await ensureSeeded();
  const rows = await prisma.alertThresholdConfig.findMany({ orderBy: { key: "asc" } });
  cache = { rows, expiresAt: now + CACHE_TTL_MS };
  return rows;
}

/** A single threshold by key, or null if the key isn't recognized. */
export async function getAlertThreshold(key: AlertThresholdKey): Promise<AlertThresholdConfig | null> {
  const rows = await getAllAlertThresholds();
  return rows.find((row) => row.key === key) ?? null;
}

type AlertThresholdErrorCode = "NOT_FOUND" | "INVALID_INPUT";

export class AlertThresholdError extends Error {
  statusCode: number;
  code: AlertThresholdErrorCode;

  constructor(message: string, statusCode: number, code: AlertThresholdErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UpdateAlertThresholdInput {
  key: string;
  thresholdCount?: number;
  windowMinutes?: number;
  enabled?: boolean;
  actorUserId: string;
}

/** Updates one threshold row (partial patch) and logs the change to AuditEvent. */
export async function updateAlertThreshold(
  input: UpdateAlertThresholdInput
): Promise<AlertThresholdConfig> {
  const { key, thresholdCount, windowMinutes, enabled, actorUserId } = input;

  await getAllAlertThresholds();
  const existing = await prisma.alertThresholdConfig.findUnique({ where: { key } });
  if (!existing) {
    throw new AlertThresholdError(`Unknown alert threshold key: ${key}`, 404, "NOT_FOUND");
  }

  if (thresholdCount !== undefined && (!Number.isInteger(thresholdCount) || thresholdCount < 1)) {
    throw new AlertThresholdError(
      "thresholdCount must be a positive integer",
      400,
      "INVALID_INPUT"
    );
  }
  if (windowMinutes !== undefined && (!Number.isInteger(windowMinutes) || windowMinutes < 1)) {
    throw new AlertThresholdError("windowMinutes must be a positive integer", 400, "INVALID_INPUT");
  }

  const updated = await prisma.alertThresholdConfig.update({
    where: { key },
    data: {
      ...(thresholdCount !== undefined ? { thresholdCount } : {}),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      updatedByUserId: actorUserId,
    },
  });

  invalidateAlertThresholdCache();

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "ALERT_THRESHOLD_UPDATED",
    outcome: "SUCCESS",
    sensitivityLevel: "INTERNAL",
    actorUserId,
    resourceType: "AlertThresholdConfig",
    resourceId: existing.id,
    description: `Alert threshold "${key}" updated`,
    beforeState: {
      thresholdCount: existing.thresholdCount,
      windowMinutes: existing.windowMinutes,
      enabled: existing.enabled,
    },
    afterState: {
      thresholdCount: updated.thresholdCount,
      windowMinutes: updated.windowMinutes,
      enabled: updated.enabled,
    },
  });

  return updated;
}
