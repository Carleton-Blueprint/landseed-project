import { logDeniedAdminAccessAttempt, type AdminAccessDeniedInput } from '@/backend/audit/adminAccess';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AdminAccessDeniedInput;

    if (!body?.routePath || !body?.resourceType || !body?.surface) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    await logDeniedAdminAccessAttempt(body);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Admin access denied audit POST error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}