import { NextFetchEvent } from 'next/server';
import type { AdminAccessDeniedInput } from '@/backend/audit/adminAccess';

export function queueDeniedAdminAccessAudit(
  event: NextFetchEvent,
  request: Request,
  input: AdminAccessDeniedInput,
): void {
  event.waitUntil(
    fetch(new URL('/api/internal/audit/admin-access-denied', request.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }).catch((error) => {
      console.error('Admin access denied audit dispatch failed:', error);
    })
  );
}