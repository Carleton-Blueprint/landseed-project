import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "lib/prisma";

export type AuditEventCategory = "MANUAL_CHANGE" | "SENSITIVE_ACCESS";
export type AuditEventOutcome = "SUCCESS" | "DENIED" | "FAILURE";
export type AuditSensitivityLevel = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export interface AuditEventInput {
  category: AuditEventCategory;
  action: string;
  outcome: AuditEventOutcome;
  sensitivityLevel?: AuditSensitivityLevel;
  actorUserId?: string | null;
  projectId?: string | null;
  quoteId?: string | null;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  description?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function getRequestAuditContext(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return getAuditContextFromHeaders(request.headers);
}

export function getAuditContextFromHeaders(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwardedFor = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp || null;

  return {
    ipAddress,
    userAgent: headers.get("user-agent"),
  };
}

function toJsonText(value: unknown): string | null {
  if (typeof value === "undefined") {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const auditEventId = randomUUID();
  const beforeStateJson = toJsonText(input.beforeState);
  const afterStateJson = toJsonText(input.afterState);
    const metadataJson = toJsonText(input.metadata);

    // Determine previous hash (global chain)
    const latest = await prisma.auditEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { eventHash: true },
    });
    const prevHash = latest?.eventHash ?? null;

    // Use an explicit createdAt so the hash is reproducible
    const createdAt = new Date();

    // Build payload for hashing (schema-compatible with backfill)
    const payloadForHash = {
      id: auditEventId,
      category: input.category,
      action: input.action,
      outcome: input.outcome,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      projectId: input.projectId ?? null,
      actorUserId: input.actorUserId ?? null,
      createdAt: createdAt.toISOString(),
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      metadata: input.metadata ?? null,
    };

    const eventHash = crypto.createHash('sha256').update(JSON.stringify(payloadForHash)).digest('hex');

    // Optionally sign the hash if a private key is provided
    let signature: string | null = null;
    let signedAt: Date | null = null;
    let signedBy: string | null = null;
    const privateKey = process.env.AUDIT_SIGNING_PRIVATE_KEY;
    if (privateKey) {
      try {
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(eventHash);
        signer.end();
        signature = signer.sign(privateKey, 'base64');
        signedAt = new Date();
        signedBy = process.env.AUDIT_SIGNING_KEY_ID ?? 'local';
      } catch (err) {
        // Signing failure should not block audit insertion; surface to logs
        console.error('Audit signing failed:', err);
        signature = null;
        signedAt = null;
        signedBy = null;
      }
    }

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "AuditEvent" (
        "id",
        "category",
        "action",
        "outcome",
        "sensitivityLevel",
        "actorUserId",
        "projectId",
        "quoteId",
        "resourceType",
        "resourceId",
        "reason",
        "description",
        "beforeState",
        "afterState",
        "metadata",
        "ipAddress",
        "userAgent"
          "eventHash",
          "prevHash",
          "signature",
          "signedAt",
          "signedBy",
          "createdAt"
      )
      VALUES (
        ${auditEventId},
        ${input.category}::"AuditEventCategory",
        ${input.action},
        ${input.outcome}::"AuditEventOutcome",
        ${(input.sensitivityLevel ?? "CONFIDENTIAL")}::"AuditSensitivityLevel",
        ${input.actorUserId ?? null},
        ${input.projectId ?? null},
        ${input.quoteId ?? null},
        ${input.resourceType},
        ${input.resourceId ?? null},
        ${input.reason ?? null},
        ${input.description ?? null},
        CAST(${beforeStateJson} AS JSONB),
        CAST(${afterStateJson} AS JSONB),
        CAST(${metadataJson} AS JSONB),
        ${input.ipAddress ?? null},
        ${input.userAgent ?? null}
          ${eventHash},
          ${prevHash ?? null},
          ${signature ?? null},
          ${signedAt ?? null},
          ${signedBy ?? null},
          ${createdAt}
      )
    `
  );
}

export async function logAuditEventNonBlocking(input: AuditEventInput): Promise<void> {
  try {
    await logAuditEvent(input);
  } catch (error) {
    // TODO: Keep audit logging non-blocking for now; revisit fail-closed behavior when high-risk
    // financial flows, privilege changes, or security-critical operations are introduced
    console.error("Audit logging failed:", error);
  }
}
