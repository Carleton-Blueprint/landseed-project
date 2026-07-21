import IORedis from "ioredis";

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
