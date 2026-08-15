import bcrypt from "bcryptjs";
import { validatePasswordStrength } from "@/shared/passwordPolicy";

const BCRYPT_COST = 12;

/** Precomputed bcrypt hash for timing-safe login failures when no user exists. */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("__dummy_timing_safe__", BCRYPT_COST);
// ensures each login attempt takes the same amount of time, regardless of the password

export { validatePasswordStrength } from "@/shared/passwordPolicy";

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
