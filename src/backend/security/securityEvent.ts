import { prisma } from "lib/prisma";
import type { SecurityEventType } from "@prisma/client";

export interface SecurityEventInput {
  eventType: SecurityEventType;
  scope: string;
  identifier: string;
  route?: string | null;
  metadata?: unknown;
}

/**
 * Logs a rate-limit hit or an alert trigger. Best-effort: a logging failure
 * must never block the request/check that triggered it, so failures are
 * swallowed after a console.error, matching logAuditEventNonBlocking's
 * non-blocking contract for the (separate, hash-chained) AuditEvent table.
 */
export async function logSecurityEventNonBlocking(input: SecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        eventType: input.eventType,
        scope: input.scope,
        identifier: input.identifier,
        route: input.route ?? null,
        metadata: input.metadata === undefined ? undefined : (input.metadata as object),
      },
    });
  } catch (error) {
    console.error("Security event logging failed:", error);
  }
}
