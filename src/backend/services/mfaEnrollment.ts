import QRCode from "qrcode";
import { prisma } from "lib/prisma";
import { generateTotpSecret, buildTotpProvisioningUri, verifyTotpToken } from "@/backend/auth/totp";
import { encryptMfaSecret, decryptMfaSecret } from "@/backend/auth/mfaSecretCrypto";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export type MfaEnrollmentErrorCode = "NOT_FOUND" | "ALREADY_ENROLLED" | "NOT_STARTED" | "INVALID_CODE";

export class MfaEnrollmentError extends Error {
  code: MfaEnrollmentErrorCode;
  statusCode: number;

  constructor(message: string, code: MfaEnrollmentErrorCode, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface MfaEnrollmentMaterial {
  /** Manual-entry fallback for when the authenticator app can't scan the QR code. */
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

/**
 * Starts (or restarts, if not yet confirmed) MFA enrollment for a user:
 * generates a new TOTP secret, stores it encrypted, and returns provisioning
 * material for a QR code. mfaEnabled stays false until confirmMfaEnrollment
 * succeeds. Calling this again before confirmation discards the previous
 * pending secret — that's expected ("regenerate QR code") UX, not a bug.
 */
export async function startMfaEnrollment(userId: string): Promise<MfaEnrollmentMaterial> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mfaEnabled: true },
  });

  if (!user) {
    throw new MfaEnrollmentError("User not found", "NOT_FOUND", 404);
  }
  if (user.mfaEnabled) {
    throw new MfaEnrollmentError(
      "MFA is already enabled for this account; ask a system administrator to reset it first",
      "ALREADY_ENROLLED",
      409
    );
  }

  const secret = generateTotpSecret();
  const otpauthUri = buildTotpProvisioningUri(secret, user.email ?? user.id);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecretCiphertext: encryptMfaSecret(secret) },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MFA_ENROLLMENT_STARTED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: userId,
    resourceType: "user_mfa",
    resourceId: userId,
    description: "Admin started MFA enrollment",
  });

  return { secret, otpauthUri, qrCodeDataUrl };
}

/** Verifies the first TOTP code and, if valid, activates MFA for the account. */
export async function confirmMfaEnrollment(userId: string, token: string): Promise<{ enrolledAt: Date }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, mfaEnabled: true, mfaSecretCiphertext: true },
  });

  if (!user) {
    throw new MfaEnrollmentError("User not found", "NOT_FOUND", 404);
  }
  if (user.mfaEnabled) {
    throw new MfaEnrollmentError("MFA is already enabled for this account", "ALREADY_ENROLLED", 409);
  }
  if (!user.mfaSecretCiphertext) {
    throw new MfaEnrollmentError(
      "No MFA enrollment in progress; start enrollment before confirming a code",
      "NOT_STARTED",
      409
    );
  }

  const secret = decryptMfaSecret(user.mfaSecretCiphertext);
  const isValid = await verifyTotpToken(secret, token);

  if (!isValid) {
    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "MFA_ENROLLMENT_CONFIRM_FAILED",
      outcome: "FAILURE",
      sensitivityLevel: "RESTRICTED",
      actorUserId: userId,
      resourceType: "user_mfa",
      resourceId: userId,
      description: "MFA enrollment confirmation failed: invalid TOTP code",
    });
    throw new MfaEnrollmentError("Invalid verification code", "INVALID_CODE", 400);
  }

  const enrolledAt = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: true, mfaEnrolledAt: enrolledAt },
  });

  await logAuditEventNonBlocking({
    category: "MANUAL_CHANGE",
    action: "MFA_ENROLLMENT_CONFIRMED",
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId: userId,
    resourceType: "user_mfa",
    resourceId: userId,
    description: "MFA enrollment confirmed and enabled",
  });

  return { enrolledAt };
}
