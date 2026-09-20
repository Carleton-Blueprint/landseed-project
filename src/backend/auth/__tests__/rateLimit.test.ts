/**
 * @jest-environment node
 */
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import {
  checkRateLimit,
  buildRateLimitKey,
  rateLimitedResponse,
  enforceRateLimit,
  enforceDualRateLimit,
} from "../rateLimit";

jest.mock("@/backend/security/securityEvent", () => ({
  logSecurityEventNonBlocking: jest.fn(),
}));

const mockEval = jest.fn();
const mockTtl = jest.fn();

jest.mock("ioredis", () =>
  jest.fn().mockImplementation(() => ({
    eval: mockEval,
    ttl: mockTtl,
  }))
);

describe("buildRateLimitKey", () => {
  it("namespaces the key by scope and identifier", () => {
    expect(buildRateLimitKey("login-ip", "1.2.3.4")).toBe("auth-rate:login-ip:1.2.3.4");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows the request when the count is within the limit", async () => {
    mockEval.mockResolvedValue(3);

    const result = await checkRateLimit("some-key", 5, 60);

    expect(result).toEqual({ allowed: true });
    expect(mockTtl).not.toHaveBeenCalled();
  });

  it("denies the request once the count exceeds the limit, using the key's TTL", async () => {
    mockEval.mockResolvedValue(6);
    mockTtl.mockResolvedValue(42);

    const result = await checkRateLimit("some-key", 5, 60);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("falls back to the window length when the key has no TTL yet", async () => {
    mockEval.mockResolvedValue(6);
    mockTtl.mockResolvedValue(-1);

    const result = await checkRateLimit("some-key", 5, 60);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 with a Retry-After header and the retry time in the body", async () => {
    const response = rateLimitedResponse({ allowed: false, retryAfterSeconds: 120 });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await response.json()).toEqual({
      error: "Too many requests. Please try again later.",
      retryAfterSeconds: 120,
    });
  });

  it("merges a custom body over the default", async () => {
    const response = rateLimitedResponse(
      { allowed: false, retryAfterSeconds: 30 },
      { error: "Slow down." }
    );

    expect(await response.json()).toEqual({ error: "Slow down.", retryAfterSeconds: 30 });
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a null response and does not log when under the limit", async () => {
    mockEval.mockResolvedValue(1);

    const { response } = await enforceRateLimit({
      scope: "test-scope",
      identifier: "1.2.3.4",
      limit: 5,
      windowSeconds: 60,
      route: "/api/test",
    });

    expect(response).toBeNull();
    expect(logSecurityEventNonBlocking).not.toHaveBeenCalled();
  });

  it("returns a 429 and logs a SecurityEvent when the limit is hit", async () => {
    mockEval.mockResolvedValue(6);
    mockTtl.mockResolvedValue(90);

    const { response } = await enforceRateLimit({
      scope: "test-scope",
      identifier: "1.2.3.4",
      limit: 5,
      windowSeconds: 60,
      route: "/api/test",
      message: "Too many test requests.",
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("90");
    expect(await response?.json()).toEqual({
      error: "Too many test requests.",
      retryAfterSeconds: 90,
    });
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith({
      eventType: "RATE_LIMIT_HIT",
      scope: "test-scope",
      identifier: "1.2.3.4",
      route: "/api/test",
      metadata: { limit: 5, windowSeconds: 60 },
    });
  });
});

describe("enforceDualRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Simulates real Redis INCR semantics: each distinct key gets its own
  // independent counter that increments per call, instead of one shared
  // mock return value for every call regardless of key.
  function mockPerKeyCounters() {
    const counts: Record<string, number> = {};
    mockEval.mockImplementation((_script: string, _numKeys: number, key: string) => {
      counts[key] = (counts[key] ?? 0) + 1;
      return Promise.resolve(counts[key]);
    });
    return counts;
  }

  it("lets two different accounts sharing one IP both pass, each under their own account limit", async () => {
    const counts = mockPerKeyCounters();

    const alice = await enforceDualRateLimit({
      scope: "shared-scope",
      accountId: "alice",
      ip: "9.9.9.9",
      accountLimit: 5,
      accountWindowSeconds: 60,
      ipLimit: 25,
      ipWindowSeconds: 60,
      route: "/api/test",
    });
    const bob = await enforceDualRateLimit({
      scope: "shared-scope",
      accountId: "bob",
      ip: "9.9.9.9",
      accountLimit: 5,
      accountWindowSeconds: 60,
      ipLimit: 25,
      ipWindowSeconds: 60,
      route: "/api/test",
    });

    expect(alice.response).toBeNull();
    expect(bob.response).toBeNull();
    // Each account has its own independent counter, unaffected by the other.
    expect(counts["auth-rate:shared-scope-account:alice"]).toBe(1);
    expect(counts["auth-rate:shared-scope-account:bob"]).toBe(1);
    // The shared IP counter reflects both requests.
    expect(counts["auth-rate:shared-scope-ip:9.9.9.9"]).toBe(2);
  });

  it("blocks once an account's own limit is exceeded, without checking the IP at all", async () => {
    mockEval.mockResolvedValueOnce(6);
    mockTtl.mockResolvedValue(30);

    const { response } = await enforceDualRateLimit({
      scope: "shared-scope",
      accountId: "alice",
      ip: "9.9.9.9",
      accountLimit: 5,
      accountWindowSeconds: 60,
      ipLimit: 25,
      ipWindowSeconds: 60,
      route: "/api/test",
      accountMessage: "Account limited.",
    });

    expect(response?.status).toBe(429);
    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it("blocks a shared IP once enough distinct accounts use it, even though no single account exceeded its own limit", async () => {
    mockPerKeyCounters();
    mockTtl.mockResolvedValue(60);

    const results = [];
    for (const accountId of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
      results.push(
        await enforceDualRateLimit({
          scope: "shared-scope",
          accountId,
          ip: "9.9.9.9",
          accountLimit: 5,
          accountWindowSeconds: 60,
          ipLimit: 5,
          ipWindowSeconds: 60,
          route: "/api/test",
        })
      );
    }

    expect(results.slice(0, 5).every((result) => result.response === null)).toBe(true);
    expect(results[5].response?.status).toBe(429);
  });

  it("skips the account check entirely when accountId is null (unauthenticated)", async () => {
    mockEval.mockResolvedValue(1);

    const { response } = await enforceDualRateLimit({
      scope: "shared-scope",
      accountId: null,
      ip: "9.9.9.9",
      accountLimit: 5,
      accountWindowSeconds: 60,
      ipLimit: 25,
      ipWindowSeconds: 60,
      route: "/api/test",
    });

    expect(response).toBeNull();
    expect(mockEval).toHaveBeenCalledTimes(1);
    expect(mockEval).toHaveBeenCalledWith(expect.any(String), 1, "auth-rate:shared-scope-ip:9.9.9.9", 60);
  });
});
