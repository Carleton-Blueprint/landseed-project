import { generateSecret, generateURI, verify } from "otplib";

const ISSUER = "LandSeed InPlace";

/**
 * otplib defaults to epochTolerance: 0 — only the exact current 30s step is
 * accepted, with no allowance for clock drift between the phone and the
 * server. otplib's own docs recommend 30 (±1 step) as the balanced default.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

/** Base32 secret, default 20 random bytes — well above otplib's 16-byte (128-bit) minimum. */
export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildTotpProvisioningUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: ISSUER, label: accountLabel, secret });
}

/**
 * otplib's guardrails throw (TokenFormatError/TokenLengthError) rather than
 * returning invalid for a token that isn't a plain digit string — e.g. one
 * with an internal space. Sanitizing and pre-validating here means a
 * malformed token resolves to "invalid code" instead of an unhandled
 * exception bubbling up to callers as a 500.
 */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  const sanitizedToken = token.replace(/\s+/g, "");
  if (!/^\d+$/.test(sanitizedToken)) {
    return false;
  }

  const result = await verify({ secret, token: sanitizedToken, epochTolerance: EPOCH_TOLERANCE_SECONDS });
  return result.valid;
}
