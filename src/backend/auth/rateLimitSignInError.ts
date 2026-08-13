import { CredentialsSignin } from "next-auth";

/**
 * Thrown from authorize() when the per-IP login rate limit is hit. Auth.js's
 * credentials flow controls the outer HTTP response itself (no way for
 * authorize() to set a custom status/header), so denial is surfaced to the
 * client via signIn()'s returned `code`, same mechanism as the mfa_* errors
 * in mfaSignInErrors.ts.
 */
export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}
