import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "@/backend/auth/password";

describe("password utilities", () => {
  describe("validatePasswordStrength", () => {
    it("accepts passwords with 8+ characters", () => {
      expect(validatePasswordStrength("password123")).toBeNull();
    });

    it("rejects passwords shorter than 8 characters", () => {
      expect(validatePasswordStrength("short")).toBe(
        "Password must be at least 8 characters."
      );
    });
  });

  describe("hashPassword", () => {
    it("returns a bcrypt hash", async () => {
      const hash = await hashPassword("password123");
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
      const hash = await hashPassword("password123");
      await expect(verifyPassword("password123", hash)).resolves.toBe(true);
    });

    it("returns false for non-matching password", async () => {
      const hash = await hashPassword("password123");
      await expect(verifyPassword("wrongpassword", hash)).resolves.toBe(false);
    });
  });
});
