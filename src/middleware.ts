import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireMinimumRole, HttpError } from "@/backend/auth/requireRole";

const ADMIN_PATHS = ["/admin", "/api/admin"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only care about configured admin paths
  const isAdminPath = ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isAdminPath) return NextResponse.next();

  // Attempt to load session
  let session;
  try {
    session = await auth();
  } catch (err) {
    // If auth helper fails, treat as unauthenticated
    session = null;
  }

  try {
    // Require STAFF or higher for admin surface
    await requireMinimumRole(session, "STAFF");
    return NextResponse.next();
  } catch (err) {
    if (err instanceof HttpError) {
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
