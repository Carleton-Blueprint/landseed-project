export const GENERIC_AUTH_EMAIL_RESPONSE = {
  success: true,
  message: "If an account exists for that email, we sent instructions.",
} as const;

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
