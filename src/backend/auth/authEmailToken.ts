import { createHash, randomBytes } from "crypto";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

export type AuthEmailTokenValidationResult =
  | { ok: true; tokenId: string; userId: string; newEmail: string | null }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

export function hashAuthEmailToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawAuthEmailToken(): string {
  return randomBytes(32).toString("base64url");
}

function ttlForPurpose(purpose: AuthEmailTokenPurpose): number {
  switch (purpose) {
    case AuthEmailTokenPurpose.EMAIL_VERIFICATION:
      return EMAIL_VERIFICATION_TTL_MS;
    case AuthEmailTokenPurpose.PASSWORD_RESET:
      return PASSWORD_RESET_TTL_MS;
    case AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM:
    case AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM:
      return EMAIL_CHANGE_TTL_MS;
    default:
      throw new Error(`Unsupported auth email token purpose: ${purpose}`);
  }
}

export async function invalidateUnusedAuthEmailTokens(
  userId: string,
  purpose: AuthEmailTokenPurpose
): Promise<void> {
  await prisma.authEmailToken.deleteMany({
    where: { userId, purpose, usedAt: null },
  });
}

export async function createAuthEmailToken(input: {
  userId: string;
  purpose: AuthEmailTokenPurpose;
  newEmail?: string;
}): Promise<{ rawToken: string; tokenId: string; expiresAt: Date }> {
  await invalidateUnusedAuthEmailTokens(input.userId, input.purpose);

  const rawToken = generateRawAuthEmailToken();
  const tokenHash = hashAuthEmailToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlForPurpose(input.purpose));

  const record = await prisma.authEmailToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash,
      newEmail: input.newEmail ?? null,
      expiresAt,
    },
  });

  return { rawToken, tokenId: record.id, expiresAt };
}

export async function findValidAuthEmailToken(
  rawToken: string,
  purpose: AuthEmailTokenPurpose
): Promise<AuthEmailTokenValidationResult> {
  const tokenHash = hashAuthEmailToken(rawToken);

  const record = await prisma.authEmailToken.findFirst({
    where: { tokenHash, purpose },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, newEmail: true },
  });

  if (!record) {
    return { ok: false, reason: "not_found" };
  }

  if (record.usedAt) {
    return { ok: false, reason: "already_used" };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, tokenId: record.id, userId: record.userId, newEmail: record.newEmail ?? null };
}

export async function consumeAuthEmailToken(
  rawToken: string,
  purpose: AuthEmailTokenPurpose
): Promise<AuthEmailTokenValidationResult> {
  const validation = await findValidAuthEmailToken(rawToken, purpose);
  if (!validation.ok) {
    return validation;
  }

  const updated = await prisma.authEmailToken.updateMany({
    where: {
      id: validation.tokenId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  if (updated.count !== 1) {
    return { ok: false, reason: "already_used" };
  }

  return validation;
}
