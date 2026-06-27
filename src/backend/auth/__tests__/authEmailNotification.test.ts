import { AuthEmailTokenPurpose, NotificationEventType } from "@prisma/client";
import {
  buildEmailVerificationIdempotencyKey,
  buildPasswordResetIdempotencyKey,
  enqueueAuthEmail,
  enqueueEmailVerificationIfNeeded,
  getAppBaseUrl,
} from "@/backend/auth/authEmailNotification";
import { createAuthEmailToken } from "@/backend/auth/authEmailToken";
import { enqueueNotification } from "@/backend/notifications/enqueue";

jest.mock("@/backend/auth/authEmailToken", () => ({
  createAuthEmailToken: jest.fn(),
}));

jest.mock("@/backend/notifications/enqueue", () => ({
  enqueueNotification: jest.fn(),
}));

describe("authEmailNotification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_BASE_URL;
    process.env.NEXTAUTH_URL = "https://landseed.test";
  });

  describe("idempotency keys", () => {
    it("builds stable email verification keys", () => {
      expect(buildEmailVerificationIdempotencyKey("user-1", "token-1")).toBe(
        "email-verify:user-1:token-1"
      );
    });

    it("builds stable password reset keys", () => {
      expect(buildPasswordResetIdempotencyKey("user-1", "token-1")).toBe(
        "password-reset:user-1:token-1"
      );
    });
  });

  describe("enqueueAuthEmail", () => {
    it("enqueues an email verification notification", async () => {
      (createAuthEmailToken as jest.Mock).mockResolvedValue({
        rawToken: "raw-token",
        tokenId: "token-1",
        expiresAt: new Date("2026-06-27T12:00:00.000Z"),
      });

      await enqueueAuthEmail({
        userId: "user-1",
        recipientEmail: "user@example.com",
        recipientName: "Alex",
        purpose: AuthEmailTokenPurpose.EMAIL_VERIFICATION,
        seniorName: "Pat",
        isCaregiverSubmission: true,
      });

      expect(enqueueNotification).toHaveBeenCalledWith({
        eventType: NotificationEventType.EMAIL_VERIFICATION,
        idempotencyKey: "email-verify:user-1:token-1",
        recipientEmail: "user@example.com",
        recipientName: "Alex",
        userId: "user-1",
        authActionLink: "https://landseed.test/api/auth/verify-email?token=raw-token",
        seniorName: "Pat",
        isCaregiverSubmission: true,
      });
    });

    it("enqueues a password reset notification", async () => {
      (createAuthEmailToken as jest.Mock).mockResolvedValue({
        rawToken: "reset-token",
        tokenId: "token-2",
        expiresAt: new Date("2026-06-26T13:00:00.000Z"),
      });

      await enqueueAuthEmail({
        userId: "user-2",
        recipientEmail: "user2@example.com",
        recipientName: "Casey",
        purpose: AuthEmailTokenPurpose.PASSWORD_RESET,
      });

      expect(enqueueNotification).toHaveBeenCalledWith({
        eventType: NotificationEventType.PASSWORD_RESET,
        idempotencyKey: "password-reset:user-2:token-2",
        recipientEmail: "user2@example.com",
        recipientName: "Casey",
        userId: "user-2",
        authActionLink: "https://landseed.test/auth/reset-password?token=reset-token",
        seniorName: undefined,
        isCaregiverSubmission: undefined,
      });
    });
  });

  describe("enqueueEmailVerificationIfNeeded", () => {
    it("skips when email is already verified", async () => {
      await enqueueEmailVerificationIfNeeded({
        userId: "user-1",
        recipientEmail: "user@example.com",
        emailVerified: new Date(),
      });

      expect(createAuthEmailToken).not.toHaveBeenCalled();
      expect(enqueueNotification).not.toHaveBeenCalled();
    });
  });

  describe("getAppBaseUrl", () => {
    it("prefers APP_BASE_URL over NEXTAUTH_URL", () => {
      process.env.APP_BASE_URL = "https://app.landseed.test";
      expect(getAppBaseUrl()).toBe("https://app.landseed.test");
    });
  });
});
