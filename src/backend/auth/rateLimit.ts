import IORedis from "ioredis";
import { NextResponse } from "next/server";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";

let redisClient: IORedis | null = null;

function getRedisClient(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

// Increment and arm the key's expiry as a single Redis-side operation. Doing this as two
// separate round-trips (INCR, then EXPIRE) leaves a window where a crash or dropped
// connection between them strands the key at its current count with no TTL — since expire
// is only ever attempted when count first hits 1, that key would then never expire again.
const INCR_AND_EXPIRE_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const count = (await redis.eval(INCR_AND_EXPIRE_SCRIPT, 1, key, windowSeconds)) as number;

  if (count > limit) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return { allowed: true };
}

export function buildRateLimitKey(scope: string, identifier: string): string {
  return `auth-rate:${scope}:${identifier}`;
}

/**
 * Builds the standard 429 response for a denied rate-limit check: a
 * `Retry-After` header (seconds) alongside the JSON body, per RFC 9110 §10.2.3.
 */
export function rateLimitedResponse(
  result: Extract<RateLimitResult, { allowed: false }>,
  body: Record<string, unknown> = { error: "Too many requests. Please try again later." }
): NextResponse {
  return NextResponse.json(
    { ...body, retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    }
  );
}

/**
 * Checks a per-IP (or other identifier-keyed) rate limit for a route and, on
 * denial, logs a SecurityEvent and returns the 429 response to send back —
 * so every call site gets both the header and the log entry for free. On
 * success (limit not hit), only the check result is returned.
 */
export async function enforceRateLimit(params: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  route: string;
  message?: string;
}): Promise<{ response: NextResponse } | { response: null }> {
  const key = buildRateLimitKey(params.scope, params.identifier);
  const result = await checkRateLimit(key, params.limit, params.windowSeconds);

  if (result.allowed) {
    return { response: null };
  }

  await logSecurityEventNonBlocking({
    eventType: "RATE_LIMIT_HIT",
    scope: params.scope,
    identifier: params.identifier,
    route: params.route,
    metadata: { limit: params.limit, windowSeconds: params.windowSeconds },
  });

  return {
    response: rateLimitedResponse(result, params.message ? { error: params.message } : undefined),
  };
}
