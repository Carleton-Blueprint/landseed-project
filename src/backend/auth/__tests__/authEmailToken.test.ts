import { AuthEmailTokenPurpose } from "@prisma/client";
import { prisma } from "lib/prisma";
import {
  consumeAuthEmailToken,
  createAuthEmailToken,
  findValidAuthEmailToken,
  generateRawAuthEmailToken,
  hashAuthEmailToken,
  invalidateUnusedAuthEmailTokens,
} from "@/backend/auth/authEmailToken";

jest.mock("lib/prisma", () => ({
  prisma: {
    authEmailToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

describe("authEmailToken utilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hashAuthEmailToken", () => {
    it("returns a stable sha256 hex digest", () => {
      const hash = hashAuthEmailToken("sample-token");
      expect(hash).toHaveLength(64);
      expect(hashAuthEmailToken("sample-token")).toBe(hash);
    });

    it("produces different hashes for different tokens", () => {
      expect(hashAuthEmailToken("token-a")).not.toBe(hashAuthEmailToken("token-b"));
    });
  });

  describe("generateRawAuthEmailToken", () => {
    it("generates unique url-safe tokens", () => {
      const first = generateRawAuthEmailToken();
      const second = generateRawAuthEmailToken();

      expect(first).not.toBe(second);
      expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("invalidateUnusedAuthEmailTokens", () => {
    it("deletes unused tokens for the user and purpose", async () => {
      await invalidateUnusedAuthEmailTokens("user-1", AuthEmailTokenPurpose.EMAIL_VERIFICATION);

      expect(prisma.authEmailToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          purpose: AuthEmailTokenPurpose.EMAIL_VERIFICATION,
          usedAt: null,
        },
      });
    });
  });

  describe("createAuthEmailToken", () => {
    it("invalidates prior tokens and stores a hashed token", async () => {
      (prisma.authEmailToken.create as jest.Mock).mockResolvedValue({
        id: "token-1",
      });

      const result = await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.PASSWORD_RESET,
      });

      expect(prisma.authEmailToken.deleteMany).toHaveBeenCalled();
      expect(prisma.authEmailToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          purpose: AuthEmailTokenPurpose.PASSWORD_RESET,
          tokenHash: hashAuthEmailToken(result.rawToken),
          expiresAt: expect.any(Date),
        }),
      });
      expect(result.tokenId).toBe("token-1");
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("uses a 24-hour expiry for email verification", async () => {
      const now = new Date("2026-06-26T12:00:00.000Z").getTime();
      jest.spyOn(Date, "now").mockReturnValue(now);
      (prisma.authEmailToken.create as jest.Mock).mockResolvedValue({ id: "token-1" });

      const result = await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.EMAIL_VERIFICATION,
      });

      expect(result.expiresAt.toISOString()).toBe("2026-06-27T12:00:00.000Z");
    });

    it("uses a 1-hour expiry for password reset", async () => {
      const now = new Date("2026-06-26T12:00:00.000Z").getTime();
      jest.spyOn(Date, "now").mockReturnValue(now);
      (prisma.authEmailToken.create as jest.Mock).mockResolvedValue({ id: "token-1" });

      const result = await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.PASSWORD_RESET,
      });

      expect(result.expiresAt.toISOString()).toBe("2026-06-26T13:00:00.000Z");
    });

    it("uses a 1-hour expiry for both email-change purposes", async () => {
      const now = new Date("2026-06-26T12:00:00.000Z").getTime();
      jest.spyOn(Date, "now").mockReturnValue(now);
      (prisma.authEmailToken.create as jest.Mock).mockResolvedValue({ id: "token-1" });

      const oldConfirm = await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
      });
      const newConfirm = await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
        newEmail: "new@example.com",
      });

      expect(oldConfirm.expiresAt.toISOString()).toBe("2026-06-26T13:00:00.000Z");
      expect(newConfirm.expiresAt.toISOString()).toBe("2026-06-26T13:00:00.000Z");
      expect(prisma.authEmailToken.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
          newEmail: "new@example.com",
        }),
      });
    });

    it("stores newEmail as null when not provided", async () => {
      (prisma.authEmailToken.create as jest.Mock).mockResolvedValue({ id: "token-1" });

      await createAuthEmailToken({
        userId: "user-1",
        purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
      });

      expect(prisma.authEmailToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ newEmail: null }),
      });
    });
  });

  describe("findValidAuthEmailToken", () => {
    it("returns not_found when no token matches", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        findValidAuthEmailToken("missing", AuthEmailTokenPurpose.EMAIL_VERIFICATION)
      ).resolves.toEqual({ ok: false, reason: "not_found" });
    });

    it("returns already_used when the token was consumed", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      });

      await expect(
        findValidAuthEmailToken("used-token", AuthEmailTokenPurpose.EMAIL_VERIFICATION)
      ).resolves.toEqual({ ok: false, reason: "already_used" });
    });

    it("returns expired when the token is past expiry", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() - 1),
        usedAt: null,
      });

      await expect(
        findValidAuthEmailToken("expired-token", AuthEmailTokenPurpose.EMAIL_VERIFICATION)
      ).resolves.toEqual({ ok: false, reason: "expired" });
    });

    it("returns the token metadata when valid", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        newEmail: null,
      });

      await expect(
        findValidAuthEmailToken("valid-token", AuthEmailTokenPurpose.EMAIL_VERIFICATION)
      ).resolves.toEqual({ ok: true, tokenId: "token-1", userId: "user-1", newEmail: null });
    });

    it("returns the pending newEmail for email-change tokens", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        newEmail: "new@example.com",
      });

      await expect(
        findValidAuthEmailToken("valid-token", AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM)
      ).resolves.toEqual({ ok: true, tokenId: "token-1", userId: "user-1", newEmail: "new@example.com" });
    });
  });

  describe("consumeAuthEmailToken", () => {
    it("marks a valid token as used", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        newEmail: null,
      });
      (prisma.authEmailToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(
        consumeAuthEmailToken("valid-token", AuthEmailTokenPurpose.PASSWORD_RESET)
      ).resolves.toEqual({ ok: true, tokenId: "token-1", userId: "user-1", newEmail: null });

      expect(prisma.authEmailToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: "token-1",
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { usedAt: expect.any(Date) },
      });
    });

    it("returns already_used when a concurrent request consumed the token first", async () => {
      (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      (prisma.authEmailToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        consumeAuthEmailToken("valid-token", AuthEmailTokenPurpose.PASSWORD_RESET)
      ).resolves.toEqual({ ok: false, reason: "already_used" });
    });
  });
});
