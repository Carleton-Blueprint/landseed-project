/**
 * Auth.js (NextAuth v5) config: providers, adapter, session strategy, and callbacks.
 * Used by the API route handler and by auth(), signIn(), signOut() across the app.
 * v5 supports Next.js 15; requires AUTH_SECRET in env.
 */
import NextAuth, { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "lib/prisma";
import { hasMinimumRole } from "@/backend/auth/requireRole";

const isDev = process.env.NODE_ENV === "development";

const nextAuthResult = NextAuth({
  // Skip DB adapter in dev — pure JWT sessions, no database needed
  ...(isDev ? {} : { adapter: PrismaAdapter(prisma) }),
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
        
        // Expose user role to client side
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
      },
      async authorize(credentials) {
        try {
          const name = typeof credentials?.name === "string" ? credentials.name.trim() : "";
          const email =
            typeof credentials?.email === "string"
              ? credentials.email.trim().toLowerCase()
              : "";
          if (!name || !email) return null;

          // ── DEV MODE: skip DB, accept any valid credentials ──────────
          if (process.env.NODE_ENV === "development") {
            return {
              id: "dev-user-" + Buffer.from(email).toString("hex").slice(0, 8),
              name,
              email,
              image: null,
            };
          }
          // ────────────────────────────────────────────────────────────

          const user = await prisma.user.findUnique({
            where: { email },
          });
          if (!user) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image || null,
          };
        } catch (error) {
          console.error("Error in authorize:", error);
          return null;
        }
      },
    }),
  ],
  // Prefer AUTH_SECRET but fall back to NEXTAUTH_SECRET for backwards compatibility
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

export const handlers = nextAuthResult.handlers;
export const signIn = nextAuthResult.signIn;
export const signOut = nextAuthResult.signOut;

// Custom auth wrapper to bypass login in development environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth = async (...args: any[]): Promise<Session | null> => {
  if (process.env.NODE_ENV === "development") {
    return {
      user: {
        id: "dev-user-id",
        name: "Dev User",
        email: "dev@example.com",
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  return await (nextAuthResult.auth as unknown as (...args: unknown[]) => Promise<Session | null>)(...args);
};
