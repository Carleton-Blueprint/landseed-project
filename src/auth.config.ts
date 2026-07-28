/**
 * Edge-safe subset of the NextAuth config: session strategy, pages, and the
 * jwt/session callbacks only — no providers, no Node-only imports (bcrypt,
 * Prisma, node:crypto). middleware.ts runs on the Edge runtime and only
 * needs to *read* an existing session, never authenticate one, so it builds
 * its own NextAuth() instance from just this config instead of importing
 * the full src/auth.ts (which pulls in the Credentials provider's
 * authorize() and everything it touches — bcrypt, Prisma, audit-log
 * signing, MFA's AES-GCM — none of which the Edge bundler can handle).
 * src/auth.ts spreads this config and adds the real providers on top.
 */
import type { NextAuthConfig } from "next-auth";
import { hasMinimumRole } from "@/backend/auth/requireRole";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { id: string; name?: string | null; email?: string | null; image?: string | null };
        token.id = u.id;
        token.name = u.name;
        token.email = u.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;

        const isAdmin = await hasMinimumRole(session, "ADMIN");
        session.user.role = isAdmin ? "ADMIN" : "USER";
      }
      return session;
    },
  },
  providers: [],
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
};
