export function getAuditContextFromHeaders(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwardedFor = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || null;

  return {
    ipAddress,
    userAgent: headers.get('user-agent'),
  };
}

export function getRequestAuditContext(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return getAuditContextFromHeaders(request.headers);
}