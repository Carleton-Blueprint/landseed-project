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

  it("resolves without throwing when both the account and IP are under their limits", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });

    await expect(enforceLoginRateLimit("1.2.3.4", "user@example.com")).resolves.toBeUndefined();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "auth-rate:login-account:user@example.com",
      5,
      900
    );
    expect(checkRateLimit).toHaveBeenCalledWith("auth-rate:login-ip:1.2.3.4", 25, 900);
    expect(logSecurityEventNonBlocking).not.toHaveBeenCalled();
  });

  it("throws RateLimitedError and logs a SecurityEvent once the account limit is hit, without checking the IP", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });

    await expect(
      enforceLoginRateLimit("1.2.3.4", "user@example.com")
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith({
      eventType: "RATE_LIMIT_HIT",
      scope: "login-account",
      identifier: "user@example.com",
      route: "/api/auth/callback/credentials",
      metadata: { limit: 5, windowSeconds: 900 },
    });
  });

  it("throws RateLimitedError and logs a SecurityEvent once the IP limit is hit after the account check passes", async () => {
    (checkRateLimit as jest.Mock)
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });

    await expect(
      enforceLoginRateLimit("1.2.3.4", "user@example.com")
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith({
      eventType: "RATE_LIMIT_HIT",
      scope: "login-ip",
      identifier: "1.2.3.4",
      route: "/api/auth/callback/credentials",
      metadata: { limit: 25, windowSeconds: 900 },
    });
  });

  it("does not let two different accounts sharing an IP block each other on the account limit", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });

    await enforceLoginRateLimit("1.2.3.4", "alice@example.com");
    await enforceLoginRateLimit("1.2.3.4", "bob@example.com");

    expect(checkRateLimit).toHaveBeenCalledWith(
      "auth-rate:login-account:alice@example.com",
      5,
      900
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      "auth-rate:login-account:bob@example.com",
      5,
      900
    );
  });

  it("skips the account check and falls through to IP-only when email is empty (malformed request)", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });

    await expect(enforceLoginRateLimit("1.2.3.4", "")).resolves.toBeUndefined();
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith("auth-rate:login-ip:1.2.3.4", 25, 900);
  });
});
