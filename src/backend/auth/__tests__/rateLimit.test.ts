/**
 * @jest-environment node
 */
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import { checkRateLimit, buildRateLimitKey, rateLimitedResponse, enforceRateLimit } from "../rateLimit";

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
