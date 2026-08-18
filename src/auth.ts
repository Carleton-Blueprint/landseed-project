/**
 * Auth.js (NextAuth v5) config: Credentials provider, JWT sessions, and callbacks.
 * Used by the API route handler and by auth(), signIn(), signOut() across the app.
 * v5 supports Next.js 15; requires AUTH_SECRET in env.
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "lib/prisma";
import { authConfig } from "@/auth.config";
import { authorizePasswordCredentials } from "@/backend/auth/passwordCredentials";
import { isAdvisoryTeamEmail } from "@/backend/auth/requireRole";
import { MfaRequiredError, MfaInvalidCodeError, MfaLockedError } from "@/backend/auth/mfaSignInErrors";
import { isMfaLockedOut, logMfaLoginLockout, verifyMfaLoginCode } from "@/backend/services/mfaLogin";
import { enforceLoginRateLimit } from "@/backend/auth/loginRateLimit";
import { getClientIp } from "@/backend/auth/authEmailResponses";

const nextAuthResult = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        name: { label: "Name", type: "text" },
        email: { label: "Email", type: "email" },
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "MFA Code", type: "text" },
      },
      async authorize(credentials, request) {
        try {
          await enforceLoginRateLimit(getClientIp(request));

          const user = await authorizePasswordCredentials(credentials ?? {});
          if (!user) {
            return null;
          }

          // Only advisory-allowlisted (admin) accounts are subject to MFA.
          if (!isAdvisoryTeamEmail(user.email)) {
            return user;
          }

          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { mfaEnabled: true },
          });

          if (!dbUser?.mfaEnabled) {
            // Not yet enrolled: let the login through — the account has no
            // second factor to check yet. Every /admin page redirects an
            // unenrolled admin to /admin/mfa-setup until they complete it
            // (src/app/admin/layout.tsx), so this session can't be used for
            // anything else in the meantime.
            return user;
          }

          if (await isMfaLockedOut(user.id)) {
            await logMfaLoginLockout(user.id);
            throw new MfaLockedError();
          }

          const mfaCode =
            credentials && typeof credentials.mfaCode === "string" ? credentials.mfaCode.trim() : "";
          if (!mfaCode) {
            throw new MfaRequiredError();
          }

          const isValidCode = await verifyMfaLoginCode(user.id, mfaCode);
          if (!isValidCode) {
            throw new MfaInvalidCodeError();
          }

          return user;
        } catch (error) {
          if (error instanceof CredentialsSignin) {
            throw error;
          }
          console.error("Error in authorize:", error);
          return null;
        }
      },
    }),
  ],
});

export const handlers = nextAuthResult.handlers;
export const signIn = nextAuthResult.signIn;
export const signOut = nextAuthResult.signOut;
export const auth = nextAuthResult.auth;
