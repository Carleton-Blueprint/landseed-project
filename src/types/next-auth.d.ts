/**
 * Extends NextAuth types so session.user includes id, and JWT includes id.
 * Importing this file (e.g. in tsconfig or a global types entry) applies the overrides.
 */
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
