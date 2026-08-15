export const MIN_PASSWORD_LENGTH = 8;

const PASSWORD_RULES = [
  {
    test: (password: string) => password.length >= MIN_PASSWORD_LENGTH,
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  },
  {
    test: (password: string) => /[A-Z]/.test(password),
    message: "Password must contain at least one uppercase letter.",
  },
  {
    test: (password: string) => /[a-z]/.test(password),
    message: "Password must contain at least one lowercase letter.",
  },
  {
    test: (password: string) => /[0-9]/.test(password),
    message: "Password must contain at least one number.",
  },
  {
    test: (password: string) => /[^A-Za-z0-9]/.test(password),
    message: "Password must contain at least one special character.",
  },
] as const;

export function validatePasswordStrength(password: string): string | null {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) {
      return rule.message;
    }
  }
  return null;
}
