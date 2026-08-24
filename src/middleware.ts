import NextAuth from "next-auth";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { requireCachedMinimumRole } from "@/backend/auth/requireCachedRole";
import { HttpError } from "@/backend/auth/httpError";
import { queueDeniedAdminAccessAudit } from "@/backend/audit/adminAccessDispatch";
import { getRequestAuditContext } from "@/backend/audit/requestContext";

// Edge-safe: built from the providerless authConfig so this Edge middleware
// never pulls in the Credentials provider's authorize() (bcrypt, Prisma,
// node:crypto via audit-log signing and MFA's AES-GCM) — see auth.config.ts.
// requireCachedMinimumRole below reads the JWT-cached role only (also no
// Prisma) — it's a fast preliminary filter, not the authoritative check.
// See requireCachedRole.ts and requireRole.ts for the live DB check that
// every admin page/route performs regardless of what this returns.
const { auth } = NextAuth(authConfig);

const ADMIN_PATHS = ["/admin", "/api/admin"];

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // Only care about configured admin paths
  const isAdminPath = ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isAdminPath) return NextResponse.next();

  // Attempt to load session
  let session;
  try {
    session = await auth();
  } catch {
    // If auth helper fails, treat as unauthenticated
    session = null;
  }

  try {
    // Require ADMIN for admin surface (JWT-cached fast-path check — see
    // requireCachedRole.ts; the live/authoritative check happens downstream)
    requireCachedMinimumRole(session, "ADMIN");

    // Forward the current pathname so src/app/admin/layout.tsx (a Node-runtime
    // Server Component, unlike this Edge middleware) can tell whether it's
    // already rendering /admin/mfa-setup without needing its own DB call here.
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  } catch (err) {
    if (err instanceof HttpError) {
      const auditContext = getRequestAuditContext(request);
      queueDeniedAdminAccessAudit(event, request, {
        surface: 'route',
        actorUserId: session?.user?.id ?? null,
        routePath: pathname,
        method: request.method,
        resourceType: 'AdminRoute',
        resourceId: pathname,
        reason: err.message,
        description: `Denied access to admin route ${pathname}`,
        ...auditContext,
        metadata: {
          source: 'middleware',
          requiredRole: 'ADMIN',
        },
      });

      if (!session?.user?.id) {
        // redirect unauthenticated browser requests to sign-in
        if (request.headers.get("accept")?.includes("text/html")) {
          const signIn = new URL("/api/auth/signin", request.url);
          signIn.searchParams.set("callbackUrl", request.url);
          return NextResponse.redirect(signIn);
        }
        return new NextResponse(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
      }

      // authenticated but insufficient privileges
      if (request.headers.get("accept")?.includes("text/html")) {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }
      return new NextResponse(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }

    return new NextResponse(JSON.stringify({ error: "server_error" }), { status: 500 });
  }
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
