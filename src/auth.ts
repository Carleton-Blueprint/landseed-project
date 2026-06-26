/**
 * Auth.js (NextAuth v5) config: Credentials provider, JWT sessions, and callbacks.
 * Used by the API route handler and by auth(), signIn(), signOut() across the app.
 * v5 supports Next.js 15; requires AUTH_SECRET in env.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";
import { authorizeLegacyCredentials } from "@/backend/auth/legacyCredentials";
import { authorizePasswordCredentials } from "@/backend/auth/passwordCredentials";
import { hasMinimumRole } from "@/backend/auth/requireRole";

const nextAuthResult = NextAuth({
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
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        name: { label: "Name", type: "text" },
        email: { label: "Email", type: "email" },
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (isDevAuthBypassEnabled()) {
            return authorizeLegacyCredentials(credentials ?? {});
          }
          return authorizePasswordCredentials(credentials ?? {});
        } catch (error) {
          console.error("Error in authorize:", error);
          return null;
        }
      },
    }),
  ],
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

export const handlers = nextAuthResult.handlers;
export const signIn = nextAuthResult.signIn;
export const signOut = nextAuthResult.signOut;
export const auth = nextAuthResult.auth;
