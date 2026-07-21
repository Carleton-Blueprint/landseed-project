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

  if (input.purpose === AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT) {
    const actionLink = `${baseUrl}/profile/change-email/confirm?token=${encodeURIComponent(rawToken)}&step=current`;
    const idempotencyKey = `email-change-current:${input.userId}:${tokenId}`;
    const recipientName = input.recipientName?.trim() || "User";

    await enqueueNotification({
      eventType: NotificationEventType.EMAIL_VERIFICATION,
      idempotencyKey,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      userId: input.userId,
      authActionLink: actionLink,
      subject: "Confirm your request to change your Landseed email",
      html: `<p>Hi ${recipientName},</p><p>We received a request to change the email address for your Landseed account.</p><p>Please click the button below to confirm that you own this current email address and wish to proceed with the change:</p><p><a href="${actionLink}" style="display:inline-block;padding:14px 24px;font-size:18px;font-weight:600;text-decoration:none;border-radius:6px;background:#1f4d3a;color:#ffffff;">Confirm current email</a></p><p>This link expires in 24 hours. If you did not request this change, you can ignore this email.</p><p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nWe received a request to change the email address for your Landseed account.\n\nPlease click the link below to confirm that you own this current email address and wish to proceed with the change:\n\n${actionLink}\n\nThis link expires in 24 hours.\n\nLandseed Team`,
    });
    return;
  }

  if (input.purpose === AuthEmailTokenPurpose.EMAIL_CHANGE_NEW) {
    const actionLink = `${baseUrl}/profile/change-email/confirm?token=${encodeURIComponent(rawToken)}&step=new`;
    const idempotencyKey = `email-change-new:${input.userId}:${tokenId}`;
    const recipientName = input.recipientName?.trim() || "User";

    await enqueueNotification({
      eventType: NotificationEventType.EMAIL_VERIFICATION,
      idempotencyKey,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      userId: input.userId,
      authActionLink: actionLink,
      subject: "Verify your new Landseed email address",
      html: `<p>Hi ${recipientName},</p><p>Please click the button below to verify your new email address and complete your Landseed account update:</p><p><a href="${actionLink}" style="display:inline-block;padding:14px 24px;font-size:18px;font-weight:600;text-decoration:none;border-radius:6px;background:#1f4d3a;color:#ffffff;">Confirm new email</a></p><p>This link expires in 24 hours.</p><p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nPlease click the link below to verify your new email address and complete your Landseed account update:\n\n${actionLink}\n\nThis link expires in 24 hours.\n\nLandseed Team`,
    });
    return;
  }

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
