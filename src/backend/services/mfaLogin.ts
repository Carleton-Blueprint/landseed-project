import { prisma } from "lib/prisma";
import { decryptMfaSecret } from "@/backend/auth/mfaSecretCrypto";
import { verifyTotpToken } from "@/backend/auth/totp";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export const MFA_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MFA_LOCKOUT_MAX_ATTEMPTS = 5;

/** Counts recent failed MFA login challenges rather than a separate counter column — the audit trail is already the source of truth for this. */
export async function isMfaLockedOut(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - MFA_LOCKOUT_WINDOW_MS);
  const recentFailures = await prisma.auditEvent.count({
    where: {
      actorUserId: userId,
      action: "MFA_CHALLENGE_FAILED",
      createdAt: { gte: since },
    },
  });

  return recentFailures >= MFA_LOCKOUT_MAX_ATTEMPTS;
}

export async function logMfaLoginLockout(userId: string): Promise<void> {
  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: "MFA_CHALLENGE_LOCKED",
    outcome: "DENIED",
    sensitivityLevel: "RESTRICTED",
    actorUserId: userId,
    resourceType: "user_mfa",
    resourceId: userId,
    description: `MFA login locked out after ${MFA_LOCKOUT_MAX_ATTEMPTS} failed attempts within ${MFA_LOCKOUT_WINDOW_MS / 60000} minutes`,
  });
}

/**
 * Verifies a TOTP code submitted during login against the user's stored
 * secret, logging a SUCCESS or DENIED audit event either way. Returns false
 * (rather than throwing) for "no secret enrolled" — callers are expected to
 * have already checked User.mfaEnabled before reaching here.
 */
export async function verifyMfaLoginCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecretCiphertext: true },
  });

  if (!user?.mfaSecretCiphertext) {
    return false;
  }

  const secret = decryptMfaSecret(user.mfaSecretCiphertext);
  const isValid = await verifyTotpToken(secret, code);

  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: isValid ? "MFA_CHALLENGE_SUCCEEDED" : "MFA_CHALLENGE_FAILED",
    outcome: isValid ? "SUCCESS" : "DENIED",
    sensitivityLevel: "RESTRICTED",
    actorUserId: userId,
    resourceType: "user_mfa",
    resourceId: userId,
    description: isValid ? "MFA login challenge succeeded" : "MFA login challenge failed: invalid code",
  });

  return isValid;
}
