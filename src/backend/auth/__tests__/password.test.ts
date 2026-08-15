import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "@/backend/auth/password";

const VALID_PASSWORD = "Password1!";

describe("password utilities", () => {
  describe("validatePasswordStrength", () => {
    it("accepts passwords that meet all complexity rules", () => {
      expect(validatePasswordStrength(VALID_PASSWORD)).toBeNull();
    });

    it("rejects passwords shorter than 8 characters", () => {
      expect(validatePasswordStrength("short")).toBe(
        "Password must be at least 8 characters."
      );
    });

    it("rejects passwords without an uppercase letter", () => {
      expect(validatePasswordStrength("password1!")).toBe(
        "Password must contain at least one uppercase letter."
      );
    });

    it("rejects passwords without a lowercase letter", () => {
      expect(validatePasswordStrength("PASSWORD1!")).toBe(
        "Password must contain at least one lowercase letter."
      );
    });

    it("rejects passwords without a number", () => {
      expect(validatePasswordStrength("Password!")).toBe(
        "Password must contain at least one number."
      );
    });

    it("rejects passwords without a special character", () => {
      expect(validatePasswordStrength("Password1")).toBe(
        "Password must contain at least one special character."
      );
    });
  });

  describe("hashPassword", () => {
    it("returns a bcrypt hash", async () => {
      const hash = await hashPassword(VALID_PASSWORD);
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it("rejects weak passwords", async () => {
      await expect(hashPassword("weak")).rejects.toThrow(
        "Password must be at least 8 characters."
      );
    });
  });

  describe("verifyPassword", () => {
    it("returns true for matching password", async () => {
      const hash = await hashPassword(VALID_PASSWORD);
      await expect(verifyPassword(VALID_PASSWORD, hash)).resolves.toBe(true);
    });

    it("returns false for non-matching password", async () => {
      const hash = await hashPassword(VALID_PASSWORD);
      await expect(verifyPassword("WrongPass1!", hash)).resolves.toBe(false);
    });
  });
});
