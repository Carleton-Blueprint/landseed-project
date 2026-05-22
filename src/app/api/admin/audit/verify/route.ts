import { NextResponse } from 'next/server';
import { verifyAuditChain } from '@/backend/audit/verify';
import { auth } from '@/auth';

export async function GET(request: Request) {
  // Require an authenticated session
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return new NextResponse(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
  }

  // Allow only advisory team emails (comma-separated list in env)
  const allowed = (process.env.ADVISORY_TEAM_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(email)) {
    return new NextResponse(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  try {
    const result = await verifyAuditChain();
    return NextResponse.json(result);
  } catch (err) {
    return new NextResponse(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
