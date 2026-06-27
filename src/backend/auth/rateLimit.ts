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

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

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
