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

          const user = await prisma.user.findUnique({
            where: { email },
          });

          // Intake creates the user first; sign-in must reuse that DB id so
          // project FK constraints succeed (dev and prod).
          if (user) {
            return {
              id: user.id,
              name: user.name ?? name,
              email: user.email,
              image: user.image || null,
            };
          }

          if (process.env.NODE_ENV === "development") {
            const phone =
              typeof credentials?.phone === "string" ? credentials.phone.trim() : null;
            const created = await prisma.user.create({
              data: { name, email, phone: phone || null },
            });
            return {
              id: created.id,
              name: created.name,
              email: created.email,
              image: null,
            };
          }

          return null;
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

// Prefer the real JWT session when present; fall back to a dev guest only when unsigned-in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth = async (...args: any[]): Promise<Session | null> => {
  const session = await (
    nextAuthResult.auth as unknown as (...args: unknown[]) => Promise<Session | null>
  )(...args);

  if (session?.user?.id) {
    return session;
  }

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

  return session;
};
