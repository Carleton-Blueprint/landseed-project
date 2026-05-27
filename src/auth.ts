/**
 * Auth.js (NextAuth v5) config: providers, adapter, session strategy, and callbacks.
 * Used by the API route handler and by auth(), signIn(), signOut() across the app.
 * v5 supports Next.js 15; requires AUTH_SECRET in env.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
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
        // Role checks are project-scoped
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
        // propagate role into the session user for easy checks
        (session.user as { role?: string }).role = token.role as string | undefined;
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
