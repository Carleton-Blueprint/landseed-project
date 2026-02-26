import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "lib/prisma";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Persist the user id and basic profile info in the JWT
        // so we can read it in the session callback and on the client.
        // Casting to any avoids adapter/provider-specific type narrowing issues.
        const u = user as any;
        token.id = u.id;
        token.name = u.name;
        token.email = u.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
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
        if (!credentials?.name?.trim()) return null;

        if (!credentials?.email?.trim()) return null;

        // Query the database for the user
        const user = await prisma.user.findUnique({
          where: { email: credentials.email?.trim() }
        });
        
        // If user not found, deny access
        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image || null,
        };
      },
    }),
  ],
  // Prefer AUTH_SECRET but fall back to NEXTAUTH_SECRET for backwards compatibility
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});

