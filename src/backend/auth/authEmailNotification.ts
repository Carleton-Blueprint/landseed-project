import { AuthEmailTokenPurpose, NotificationEventType } from "@prisma/client";
import { createAuthEmailToken } from "@/backend/auth/authEmailToken";
import { enqueueNotification } from "@/backend/notifications/enqueue";

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export function buildEmailVerificationIdempotencyKey(userId: string, tokenId: string): string {
  return `email-verify:${userId}:${tokenId}`;
}

export function buildPasswordResetIdempotencyKey(userId: string, tokenId: string): string {
  return `password-reset:${userId}:${tokenId}`;
}

export type EnqueueAuthEmailInput = {
  userId: string;
  recipientEmail: string;
  recipientName?: string | null;
  purpose: AuthEmailTokenPurpose;
  seniorName?: string | null;
  isCaregiverSubmission?: boolean;
};

export async function enqueueAuthEmail(input: EnqueueAuthEmailInput): Promise<void> {
  const { rawToken, tokenId } = await createAuthEmailToken({
    userId: input.userId,
    purpose: input.purpose,
  });

  const baseUrl = getAppBaseUrl();
  const isVerification = input.purpose === AuthEmailTokenPurpose.EMAIL_VERIFICATION;
  const eventType = isVerification
    ? NotificationEventType.EMAIL_VERIFICATION
    : NotificationEventType.PASSWORD_RESET;

  const actionLink = isVerification
    ? `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`
    : `${baseUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

  const idempotencyKey = isVerification
    ? buildEmailVerificationIdempotencyKey(input.userId, tokenId)
    : buildPasswordResetIdempotencyKey(input.userId, tokenId);

  await enqueueNotification({
    eventType,
    idempotencyKey,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    userId: input.userId,
    authActionLink: actionLink,
    seniorName: input.seniorName,
    isCaregiverSubmission: input.isCaregiverSubmission,
  });
}

export function buildEmailChangeOldConfirmIdempotencyKey(userId: string, tokenId: string): string {
  return `email-change-old:${userId}:${tokenId}`;
}

export function buildEmailChangeNewConfirmIdempotencyKey(userId: string, tokenId: string): string {
  return `email-change-new:${userId}:${tokenId}`;
}

export type EnqueueEmailChangeVerificationInput = {
  userId: string;
  purpose:
    | typeof AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM
    | typeof AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM;
  newEmail: string;
  recipientEmail: string;
  recipientName?: string | null;
};

export async function enqueueEmailChangeVerification(input: EnqueueEmailChangeVerificationInput): Promise<void> {
  const { rawToken, tokenId } = await createAuthEmailToken({
    userId: input.userId,
    purpose: input.purpose,
    newEmail: input.newEmail,
  });

  const baseUrl = getAppBaseUrl();
  const isOldConfirm = input.purpose === AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM;
  const eventType = isOldConfirm
    ? NotificationEventType.EMAIL_CHANGE_VERIFY_OLD
    : NotificationEventType.EMAIL_CHANGE_VERIFY_NEW;

  const actionLink = isOldConfirm
    ? `${baseUrl}/api/account/email-change/verify-old?token=${encodeURIComponent(rawToken)}`
    : `${baseUrl}/api/account/email-change/verify-new?token=${encodeURIComponent(rawToken)}`;

  const idempotencyKey = isOldConfirm
    ? buildEmailChangeOldConfirmIdempotencyKey(input.userId, tokenId)
    : buildEmailChangeNewConfirmIdempotencyKey(input.userId, tokenId);

  await enqueueNotification({
    eventType,
    idempotencyKey,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    userId: input.userId,
    authActionLink: actionLink,
    newEmail: input.newEmail,
  });
}

export async function enqueueEmailVerificationIfNeeded(input: {
  userId: string;
  recipientEmail: string;
  recipientName?: string | null;
  emailVerified?: Date | null;
  seniorName?: string | null;
  isCaregiverSubmission?: boolean;
}): Promise<void> {
  if (input.emailVerified) {
    return;
  }

  await enqueueAuthEmail({
    userId: input.userId,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    purpose: AuthEmailTokenPurpose.EMAIL_VERIFICATION,
    seniorName: input.seniorName,
    isCaregiverSubmission: input.isCaregiverSubmission,
  });
}
