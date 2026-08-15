/**
 * @jest-environment node
 */
import { checkRateLimit } from "@/backend/auth/rateLimit";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import { RateLimitedError } from "@/backend/auth/rateLimitSignInError";

// next-auth ships ESM that Jest can't parse without a full transform config;
// mfaSignInErrors.ts's CredentialsSignin subclasses hit the same issue, so
// stub the one export this module tree needs from it.
jest.mock("next-auth", () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  buildRateLimitKey: (scope: string, identifier: string) => `auth-rate:${scope}:${identifier}`,
  checkRateLimit: jest.fn(),
}));

jest.mock("@/backend/security/securityEvent", () => ({
  logSecurityEventNonBlocking: jest.fn(),
}));

import { enforceLoginRateLimit } from "../loginRateLimit";

describe("enforceLoginRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves without throwing when under the limit", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });

    await expect(enforceLoginRateLimit("1.2.3.4")).resolves.toBeUndefined();
    expect(logSecurityEventNonBlocking).not.toHaveBeenCalled();
  });

  it("throws RateLimitedError and logs a SecurityEvent once the limit is hit", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    await expect(enforceLoginRateLimit("1.2.3.4")).rejects.toBeInstanceOf(RateLimitedError);
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith({
      eventType: "RATE_LIMIT_HIT",
      scope: "login-ip",
      identifier: "1.2.3.4",
      route: "/api/auth/callback/credentials",
      metadata: { limit: 5, windowSeconds: 900 },
    });
  });
});
