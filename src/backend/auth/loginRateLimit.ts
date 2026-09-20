import { buildRateLimitKey, checkRateLimit } from "@/backend/auth/rateLimit";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import { RateLimitedError } from "@/backend/auth/rateLimitSignInError";

const ACCOUNT_LOGIN_LIMIT = 5;
const ACCOUNT_LOGIN_WINDOW_SECONDS = 15 * 60;

const IP_LOGIN_LIMIT = 25;
const IP_LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * Throws RateLimitedError once either limit is hit: 5 attempts per 15
 * minutes for the account being logged into (primary gate, so one person
 * fumbling their password only affects their own account — not everyone
 * sharing an IP, e.g. a retirement residence), or 25 attempts per 15
 * minutes for the IP (backstop against credential stuffing spread across
 * many accounts from one address). `email` should already be normalized
 * (trimmed + lowercased); an empty string skips the account check (no
 * account to key by, e.g. a malformed request) and falls through to IP-only.
 */
export async function enforceLoginRateLimit(clientIp: string, email: string): Promise<void> {
  if (email) {
    const accountResult = await checkRateLimit(
      buildRateLimitKey("login-account", email),
      ACCOUNT_LOGIN_LIMIT,
      ACCOUNT_LOGIN_WINDOW_SECONDS
    );

    if (!accountResult.allowed) {
      await logSecurityEventNonBlocking({
        eventType: "RATE_LIMIT_HIT",
        scope: "login-account",
        identifier: email,
        route: "/api/auth/callback/credentials",
        metadata: { limit: ACCOUNT_LOGIN_LIMIT, windowSeconds: ACCOUNT_LOGIN_WINDOW_SECONDS },
      });

      throw new RateLimitedError();
    }
  }

  const ipResult = await checkRateLimit(
    buildRateLimitKey("login-ip", clientIp),
    IP_LOGIN_LIMIT,
    IP_LOGIN_WINDOW_SECONDS
  );

  if (ipResult.allowed) {
    return;
  }

  await logSecurityEventNonBlocking({
    eventType: "RATE_LIMIT_HIT",
    scope: "login-ip",
    identifier: clientIp,
    route: "/api/auth/callback/credentials",
    metadata: { limit: IP_LOGIN_LIMIT, windowSeconds: IP_LOGIN_WINDOW_SECONDS },
  });

  throw new RateLimitedError();
}
