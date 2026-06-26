import { Session } from "next-auth";
import { prisma } from "lib/prisma";
import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";
import { HttpError } from "@/backend/auth/requireRole";

export const EMAIL_VERIFICATION_REQUIRED_CODE = "EMAIL_VERIFICATION_REQUIRED";

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email before continuing. Check your inbox or resend a verification email from your dashboard.";

export class EmailVerificationRequiredError extends Error {
  readonly status = 403;
  readonly code = EMAIL_VERIFICATION_REQUIRED_CODE;

  constructor(message = EMAIL_VERIFICATION_REQUIRED_MESSAGE) {
    super(message);
    this.name = "EmailVerificationRequiredError";
  }
}

export function isEmailVerificationEnforced(): boolean {
  return !isDevAuthBypassEnabled();
}

export async function hasVerifiedEmail(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });

  if (!user?.email) {
    return true;
  }

  return Boolean(user.emailVerified);
}

export async function requireVerifiedEmail(session: Session | null | undefined): Promise<void> {
  if (!session?.user?.id) {
    throw new HttpError("unauthenticated", 401);
  }

  if (!isEmailVerificationEnforced()) {
    return;
  }

  const verified = await hasVerifiedEmail(session.user.id);
  if (!verified) {
    throw new EmailVerificationRequiredError();
  }
}
