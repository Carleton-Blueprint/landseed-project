import { buildRateLimitKey, checkRateLimit } from "@/backend/auth/rateLimit";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import { RateLimitedError } from "@/backend/auth/rateLimitSignInError";

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

/** Throws RateLimitedError once an IP exceeds 5 login attempts per 15 minutes. */
export async function enforceLoginRateLimit(clientIp: string): Promise<void> {
  const result = await checkRateLimit(
    buildRateLimitKey("login-ip", clientIp),
    LOGIN_LIMIT,
    LOGIN_WINDOW_SECONDS
  );

  if (result.allowed) {
    return;
  }

  await logSecurityEventNonBlocking({
    eventType: "RATE_LIMIT_HIT",
    scope: "login-ip",
    identifier: clientIp,
    route: "/api/auth/callback/credentials",
    metadata: { limit: LOGIN_LIMIT, windowSeconds: LOGIN_WINDOW_SECONDS },
  });

  throw new RateLimitedError();
}
