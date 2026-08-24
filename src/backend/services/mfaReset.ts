/**
 * Admin-initiated MFA reset: lets one enrolled admin clear another admin's
 * MFA enrollment (lost/broken/stolen authenticator device) so they can
 * re-enroll on next login. Peer-assisted only — see resetAdminMfa.
 */

import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export const MFA_RESET_AUDIT_ACTION = "MFA_RESET";

type MfaResetErrorCode =
  | "TARGET_NOT_FOUND"
  | "TARGET_NOT_AN_ADMIN"
  | "CANNOT_RESET_SELF"
  | "MFA_NOT_ENROLLED";

export class MfaResetError extends Error {
  statusCode: number;
  code: MfaResetErrorCode;

  constructor(message: string, statusCode: number, code: MfaResetErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AdminMfaStatus {
  id: string;
  email: string;
  mfaEnabled: boolean;
  mfaEnrolledAt: Date | null;
}

/** Lists admin users along with their current MFA enrollment status. */
export async function listAdminsWithMfaStatus(): Promise<AdminMfaStatus[]> {
  const users = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true, email: true, mfaEnabled: true, mfaEnrolledAt: true },
    orderBy: { email: "asc" },
  });

  return users
    .filter((u): u is typeof u & { email: string } => u.email !== null)
    .map((u) => ({ id: u.id, email: u.email, mfaEnabled: u.mfaEnabled, mfaEnrolledAt: u.mfaEnrolledAt }));
}

export interface ResetAdminMfaInput {
  targetUserId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function resetAdminMfa(input: ResetAdminMfaInput): Promise<AdminMfaStatus> {
  const { targetUserId, actorUserId, ipAddress, userAgent } = input;

  if (targetUserId === actorUserId) {
    throw new MfaResetError(
      "You can't reset your own MFA enrollment — ask another admin to do it for you",
      400,
      "CANNOT_RESET_SELF"
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, role: true, mfaEnabled: true, mfaEnrolledAt: true },
  });

  if (!target) {
    throw new MfaResetError("Target user not found", 404, "TARGET_NOT_FOUND");
  }

  if (target.role !== "ADMIN") {
    throw new MfaResetError("Target user is not an admin", 400, "TARGET_NOT_AN_ADMIN");
  }

  if (!target.mfaEnabled) {
    throw new MfaResetError("Target user does not have MFA enrolled", 400, "MFA_NOT_ENROLLED");
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { mfaEnabled: false, mfaSecretCiphertext: null, mfaEnrolledAt: null },
  });

  await logAuditEventNonBlocking({
    category: "SENSITIVE_ACCESS",
    action: MFA_RESET_AUDIT_ACTION,
    outcome: "SUCCESS",
    sensitivityLevel: "RESTRICTED",
    actorUserId,
    resourceType: "user_mfa",
    resourceId: targetUserId,
    description: `MFA enrollment reset for ${target.email} by admin ${actorUserId}`,
    metadata: { targetUserId, targetEmail: target.email },
    beforeState: { mfaEnabled: true, mfaEnrolledAt: target.mfaEnrolledAt },
    afterState: { mfaEnabled: false, mfaEnrolledAt: null },
    ipAddress,
    userAgent,
  });

  return { id: target.id, email: target.email as string, mfaEnabled: false, mfaEnrolledAt: null };
}
