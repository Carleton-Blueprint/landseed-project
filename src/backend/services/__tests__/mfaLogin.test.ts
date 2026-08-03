/**
 * @jest-environment node
 */
import { randomBytes } from "node:crypto";
import { generate } from "otplib";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { encryptMfaSecret } from "@/backend/auth/mfaSecretCrypto";
import {
  isMfaLockedOut,
  logMfaLoginLockout,
  verifyMfaLoginCode,
  MFA_LOCKOUT_MAX_ATTEMPTS,
} from "../mfaLogin";

const ORIGINAL_KEY = process.env.MFA_ENCRYPTION_KEY;

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const mockedCount = jest.fn();
const mockedFindUnique = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    auditEvent: {
      count: (...args: unknown[]) => mockedCount(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockedFindUnique(...args),
    },
  },
}));

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

describe("mfaLogin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.MFA_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  describe("isMfaLockedOut", () => {
    it("is false when recent failures are below the max", async () => {
      mockedCount.mockResolvedValue(MFA_LOCKOUT_MAX_ATTEMPTS - 1);
      expect(await isMfaLockedOut("user-1")).toBe(false);
    });

    it("is true once recent failures reach the max", async () => {
      mockedCount.mockResolvedValue(MFA_LOCKOUT_MAX_ATTEMPTS);
      expect(await isMfaLockedOut("user-1")).toBe(true);

      const whereArg = mockedCount.mock.calls[0][0].where;
      expect(whereArg.actorUserId).toBe("user-1");
      expect(whereArg.action).toBe("MFA_CHALLENGE_FAILED");
    });
  });

  describe("logMfaLoginLockout", () => {
    it("logs a locked-out audit event", async () => {
      await logMfaLoginLockout("user-1");
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "MFA_CHALLENGE_LOCKED",
          outcome: "DENIED",
          actorUserId: "user-1",
        })
      );
    });
  });

  describe("verifyMfaLoginCode", () => {
    it("returns true and logs success for a valid code", async () => {
      const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      mockedFindUnique.mockResolvedValue({ mfaSecretCiphertext: encryptMfaSecret(secret) });
      const validCode = await generate({ secret });

      expect(await verifyMfaLoginCode("user-1", validCode)).toBe(true);
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "MFA_CHALLENGE_SUCCEEDED", outcome: "SUCCESS" })
      );
    });

    it("returns false and logs failure for an invalid code", async () => {
      const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      mockedFindUnique.mockResolvedValue({ mfaSecretCiphertext: encryptMfaSecret(secret) });

      expect(await verifyMfaLoginCode("user-1", "000000")).toBe(false);
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "MFA_CHALLENGE_FAILED", outcome: "DENIED" })
      );
    });

    it("returns false without logging when the user has no enrolled secret", async () => {
      mockedFindUnique.mockResolvedValue({ mfaSecretCiphertext: null });

      expect(await verifyMfaLoginCode("user-1", "123456")).toBe(false);
      expect(mockedAudit).not.toHaveBeenCalled();
    });
  });
});
