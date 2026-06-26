import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;

/** Precomputed bcrypt hash for timing-safe login failures when no user exists. */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("__dummy_timing_safe__", BCRYPT_COST);
// ensures each login attempt takes the same amount of time, regardless of the password

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  const strengthError = validatePasswordStrength(plain);
  if (strengthError) {
    throw new Error(strengthError);
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
