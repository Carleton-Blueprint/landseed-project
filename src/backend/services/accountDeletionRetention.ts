import { AccountDeletionNoticeType, AccountDeletionRequestStatus, Prisma } from "@prisma/client";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { prisma } from "lib/prisma";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS_ENV = "ACCOUNT_DELETION_GRACE_PERIOD_DAYS";
export const ACCOUNT_DELETION_ADVANCE_NOTICE_DAYS_ENV = "ACCOUNT_DELETION_ADVANCE_NOTICE_DAYS";
export const DEFAULT_ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;
export const DEFAULT_ACCOUNT_DELETION_ADVANCE_NOTICE_DAYS = 7;

export interface AccountDeletionRetentionSettings {
  gracePeriodDays: number;
  advanceNoticeDays: number;
}

export interface AccountDeletionRequestInput {
  targetUserId: string;
  requestedByUserId?: string | null;
  requestMetadata?: Prisma.InputJsonValue;
  reason?: string | null;
}

export interface AccountDeletionRequestResult {
  id: string;
  targetUserId: string | null;
  targetUserEmailSnapshot: string;
  targetUserNameSnapshot: string | null;
  requestedAt: Date;
  gracePeriodEndsAt: Date;
  advanceNoticeDueAt: Date;
  status: AccountDeletionRequestStatus;
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

export function getAccountDeletionRetentionSettings(): AccountDeletionRetentionSettings {
  return {
    gracePeriodDays:
      parsePositiveIntegerEnv(process.env[ACCOUNT_DELETION_GRACE_PERIOD_DAYS_ENV]) ??
      DEFAULT_ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
    advanceNoticeDays:
      parsePositiveIntegerEnv(process.env[ACCOUNT_DELETION_ADVANCE_NOTICE_DAYS_ENV]) ??
      DEFAULT_ACCOUNT_DELETION_ADVANCE_NOTICE_DAYS,
  };
}

export function buildAccountDeletionSchedule(
  requestedAt: Date,
  settings: AccountDeletionRetentionSettings = getAccountDeletionRetentionSettings()
): { gracePeriodEndsAt: Date; advanceNoticeDueAt: Date } {
  if (settings.advanceNoticeDays > settings.gracePeriodDays) {
    throw new Error("Account deletion advance notice must occur before the grace period ends");
  }

  const gracePeriodEndsAt = new Date(requestedAt.getTime() + settings.gracePeriodDays * DAY_IN_MS);
  const advanceNoticeDueAt = new Date(
    gracePeriodEndsAt.getTime() - settings.advanceNoticeDays * DAY_IN_MS
  );

  return {
    gracePeriodEndsAt,
    advanceNoticeDueAt,
  };
}

export async function getActiveAccountDeletionRequest(targetUserId: string) {
  return prisma.accountDeletionRequest.findFirst({
    where: {
      targetUserId,
      status: {
        in: [
          AccountDeletionRequestStatus.REQUESTED,
          AccountDeletionRequestStatus.IN_GRACE_PERIOD,
          AccountDeletionRequestStatus.READY_FOR_DELETION,
        ],
      },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function requestAccountDeletion(
  input: AccountDeletionRequestInput
): Promise<AccountDeletionRequestResult> {
  const settings = getAccountDeletionRetentionSettings();
  const requestedAt = new Date();

  const requestedByUser = input.requestedByUserId
    ? await prisma.user.findUnique({
        where: { id: input.requestedByUserId },
        select: {
          id: true,
          email: true,
          name: true,
        },
      })
    : null;

  const targetUser = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  if (!targetUser) {
    throw new Error(`Target user not found: ${input.targetUserId}`);
  }

  if (!targetUser.email) {
    throw new Error(`Target user is missing an email address: ${input.targetUserId}`);
  }

  const existing = await getActiveAccountDeletionRequest(input.targetUserId);
  if (existing) {
    return {
      id: existing.id,
      targetUserId: existing.targetUserId,
      targetUserEmailSnapshot: existing.targetUserEmailSnapshot,
      targetUserNameSnapshot: existing.targetUserNameSnapshot,
      requestedAt: existing.requestedAt,
      gracePeriodEndsAt: existing.gracePeriodEndsAt,
      advanceNoticeDueAt: existing.advanceNoticeDueAt,
      status: existing.status,
    };
  }

  const schedule = buildAccountDeletionSchedule(requestedAt, settings);

  const created = await prisma.accountDeletionRequest.create({
    data: {
      targetUserId: targetUser.id,
      targetUserEmailSnapshot: targetUser.email,
      targetUserNameSnapshot: targetUser.name,
      requestedByUserId: input.requestedByUserId ?? null,
      requestedByEmailSnapshot: requestedByUser?.email ?? null,
      requestedByNameSnapshot: requestedByUser?.name ?? null,
      status: AccountDeletionRequestStatus.REQUESTED,
      requestedAt,
      gracePeriodEndsAt: schedule.gracePeriodEndsAt,
      advanceNoticeDueAt: schedule.advanceNoticeDueAt,
      requestMetadata: input.requestMetadata ?? undefined,
    },
    select: {
      id: true,
      targetUserId: true,
      targetUserEmailSnapshot: true,
      targetUserNameSnapshot: true,
      requestedAt: true,
      gracePeriodEndsAt: true,
      advanceNoticeDueAt: true,
      status: true,
    },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "ACCOUNT_DELETION_REQUESTED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.requestedByUserId ?? input.targetUserId,
    resourceType: "account_deletion_request",
    resourceId: created.id,
    description: "Account deletion request created and grace period scheduled",
    metadata: {
      targetUserId: input.targetUserId,
      gracePeriodDays: settings.gracePeriodDays,
      advanceNoticeDays: settings.advanceNoticeDays,
      requestedAt: requestedAt.toISOString(),
    },
  });

  return created;
}

export async function cancelAccountDeletionRequest(input: {
  requestId: string;
  actorUserId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, targetUserId: true },
  });

  if (!request) {
    throw new Error(`Account deletion request not found: ${input.requestId}`);
  }

  if (
    request.status === AccountDeletionRequestStatus.CANCELLED ||
    request.status === AccountDeletionRequestStatus.DELETED
  ) {
    return;
  }

  await prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: {
      status: AccountDeletionRequestStatus.CANCELLED,
      cancelledAt: new Date(),
      lastError: input.reason?.trim() || null,
    },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "ACCOUNT_DELETION_CANCELLED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: input.actorUserId ?? request.targetUserId,
    resourceType: "account_deletion_request",
    resourceId: request.id,
    description: "Account deletion request cancelled before the grace period completed",
    metadata: {
      reason: input.reason ?? null,
    },
  });
}

export async function createAccountDeletionNotice(input: {
  requestId: string;
  noticeType: AccountDeletionNoticeType;
  scheduledFor?: Date;
}): Promise<string> {
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      targetUserEmailSnapshot: true,
      targetUserNameSnapshot: true,
      gracePeriodEndsAt: true,
      advanceNoticeDueAt: true,
    },
  });

  if (!request) {
    throw new Error(`Account deletion request not found: ${input.requestId}`);
  }

  const scheduledFor =
    input.scheduledFor ??
    (input.noticeType === AccountDeletionNoticeType.ADVANCE_NOTICE
      ? request.advanceNoticeDueAt
      : request.gracePeriodEndsAt);

  const notice = await prisma.accountDeletionNotice.create({
    data: {
      accountDeletionRequestId: request.id,
      noticeType: input.noticeType,
      recipientEmail: request.targetUserEmailSnapshot,
      recipientName: request.targetUserNameSnapshot,
      scheduledFor,
      status: "PENDING",
    },
    select: { id: true },
  });

  return notice.id;
}

export async function finalizeAccountDeletionRequest(input: {
  requestId: string;
  actorUserId?: string | null;
  reason?: string | null;
}): Promise<void> {
  const request = await prisma.accountDeletionRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, targetUserId: true },
  });

  if (!request) throw new Error(`Account deletion request not found: ${input.requestId}`);

  if (request.status !== AccountDeletionRequestStatus.READY_FOR_DELETION) {
    return;
  }

  const now = new Date();

  try {
    let claimed = false;

    await prisma.$transaction(async (tx) => {
      const result = await tx.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          status: AccountDeletionRequestStatus.READY_FOR_DELETION,
        },
        data: {
          status: AccountDeletionRequestStatus.DELETED,
          deletedAt: now,
        },
      });

      if (result.count === 0) return;
      claimed = true;

      if (request.targetUserId) {
        await tx.session.deleteMany({ where: { userId: request.targetUserId } });
        await tx.account.deleteMany({ where: { userId: request.targetUserId } });

        await tx.user.update({
          where: { id: request.targetUserId },
          data: {
            name: null,
            email: null,
            phone: null,
            image: null,
            emailVerified: null,
            updatedAt: now,
          },
        });
      }
    });

    if (!claimed) return;

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ACCOUNT_DELETION_COMPLETED",
      outcome: "SUCCESS",
      sensitivityLevel: "RESTRICTED",
      actorUserId: input.actorUserId ?? request.targetUserId ?? undefined,
      resourceType: "account_deletion_request",
      resourceId: request.id,
      description: "Account deletion finalized and PII removed",
      metadata: { reason: input.reason ?? null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { lastError: message },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ACCOUNT_DELETION_COMPLETION_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: input.actorUserId ?? request.targetUserId ?? undefined,
      resourceType: "account_deletion_request",
      resourceId: request.id,
      description: "Account deletion finalization failed",
      metadata: { error: message },
    });

    throw err;
  }
}
