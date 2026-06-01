import {
  AuditEventCategory,
  AuditEventOutcome,
  AuditSensitivityLevel,
} from '@prisma/client';
import { logAuditEventNonBlocking, type AuditEventInput } from '@/backend/audit/log';

export const ADMIN_ACCESS_DENIED_ACTIONS = {
  ROUTE: 'ADMIN_ROUTE_ACCESS_DENIED',
  DATA: 'ADMIN_DATA_ACCESS_DENIED',
} as const;

export type AdminAccessDeniedSurface = 'route' | 'data';

export interface AdminAccessDeniedInput {
  surface: AdminAccessDeniedSurface;
  actorUserId?: string | null;
  routePath: string;
  method?: string | null;
  resourceType: string;
  resourceId?: string | null;
  projectId?: string | null;
  quoteId?: string | null;
  reason?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function buildDeniedAdminAccessEvent(input: AdminAccessDeniedInput): AuditEventInput {
  const action =
    input.surface === 'route'
      ? ADMIN_ACCESS_DENIED_ACTIONS.ROUTE
      : ADMIN_ACCESS_DENIED_ACTIONS.DATA;

  return {
    category: AuditEventCategory.SENSITIVE_ACCESS,
    action,
    outcome: AuditEventOutcome.DENIED,
    sensitivityLevel: AuditSensitivityLevel.RESTRICTED,
    actorUserId: input.actorUserId ?? null,
    projectId: input.projectId ?? null,
    quoteId: input.quoteId ?? null,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    reason: input.reason ?? 'Unauthorized access attempt',
    description: input.description ?? 'Denied access to a restricted admin surface',
    metadata: {
      surface: input.surface,
      routePath: input.routePath,
      method: input.method ?? null,
      ...input.metadata,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
}

export async function logDeniedAdminAccessAttempt(input: AdminAccessDeniedInput): Promise<void> {
  await logAuditEventNonBlocking(buildDeniedAdminAccessEvent(input));
}

export function buildDeniedAdminAccessEventForTest(input: AdminAccessDeniedInput): AuditEventInput {
  return buildDeniedAdminAccessEvent(input);
}