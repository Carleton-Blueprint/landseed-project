import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/backend/audit/verify";
import { auth } from "@/auth";
import { requireMinimumRole, HttpError } from "@/backend/auth/requireRole";

export async function GET(request: Request) {
  try {
    const session = await auth();
    try {
      // Require STAFF or higher to run the audit verify
      await requireMinimumRole(session, "STAFF");
    } catch (err) {
      if (err instanceof HttpError) {
        return new NextResponse(JSON.stringify({ error: err.message }), { status: err.status });
      }
      return new NextResponse(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }

    const result = await verifyAuditChain();
    return NextResponse.json(result);
  } catch (err) {
    return new NextResponse(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
