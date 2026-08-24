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
      role?: "ADMIN" | "USER";
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    /** Cached from User.role at sign-in — see auth.config.ts. Only a fast-path
     * hint for Edge middleware; every authoritative check re-reads the DB. */
    role?: "ADMIN" | "USER";
  }
}
