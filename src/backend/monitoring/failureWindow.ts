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

// Same INCR+EXPIRE-as-one-op pattern as auth/rateLimit.ts, applied here to a
// rolling failure-count window instead of a request-rate limit.
const INCR_AND_EXPIRE_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/** Increments a rolling failure counter and returns the count after incrementing. */
export async function incrementFailureCounter(key: string, windowSeconds: number): Promise<number> {
  const redis = getRedisClient();
  return (await redis.eval(INCR_AND_EXPIRE_SCRIPT, 1, key, windowSeconds)) as number;
}
