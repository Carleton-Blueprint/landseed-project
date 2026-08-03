/**
 * @jest-environment node
 */
import { randomBytes } from "node:crypto";
import { generate } from "otplib";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { decryptMfaSecret } from "@/backend/auth/mfaSecretCrypto";
import { startMfaEnrollment, confirmMfaEnrollment } from "../mfaEnrollment";

const ORIGINAL_KEY = process.env.MFA_ENCRYPTION_KEY;

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

const mockedFindUnique = jest.fn();
const mockedUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockedFindUnique(...args),
      update: (...args: unknown[]) => mockedUpdate(...args),
    },
  },
}));

const mockedAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

describe("mfaEnrollment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.MFA_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  describe("startMfaEnrollment", () => {
    it("generates and stores an encrypted secret, returning QR provisioning material", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", email: "admin@example.com", mfaEnabled: false });
      mockedUpdate.mockResolvedValue({});

      const material = await startMfaEnrollment("user-1");

      expect(material.secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(material.otpauthUri).toContain("LandSeed");
      expect(material.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

      expect(mockedUpdate).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { mfaSecretCiphertext: expect.any(String) },
      });
      const storedCiphertext = mockedUpdate.mock.calls[0][0].data.mfaSecretCiphertext;
      expect(decryptMfaSecret(storedCiphertext)).toBe(material.secret);

      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "MFA_ENROLLMENT_STARTED", outcome: "SUCCESS" })
      );
    });

    it("throws ALREADY_ENROLLED when MFA is already enabled", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", email: "admin@example.com", mfaEnabled: true });

      await expect(startMfaEnrollment("user-1")).rejects.toMatchObject({ code: "ALREADY_ENROLLED" });
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when the user doesn't exist", async () => {
      mockedFindUnique.mockResolvedValue(null);

      await expect(startMfaEnrollment("ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("confirmMfaEnrollment", () => {
    it("activates MFA when the token is valid", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", email: "admin@example.com", mfaEnabled: false });
      mockedUpdate.mockResolvedValue({});
      const { secret } = await startMfaEnrollment("user-1");
      const storedCiphertext = mockedUpdate.mock.calls[0][0].data.mfaSecretCiphertext;

      mockedFindUnique.mockResolvedValue({
        id: "user-1",
        mfaEnabled: false,
        mfaSecretCiphertext: storedCiphertext,
      });

      const validToken = await generate({ secret });
      const result = await confirmMfaEnrollment("user-1", validToken);

      expect(result.enrolledAt).toBeInstanceOf(Date);
      expect(mockedUpdate).toHaveBeenLastCalledWith({
        where: { id: "user-1" },
        data: { mfaEnabled: true, mfaEnrolledAt: result.enrolledAt },
      });
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "MFA_ENROLLMENT_CONFIRMED", outcome: "SUCCESS" })
      );
    });

    it("throws INVALID_CODE and logs a failure audit event when the token is wrong", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", email: "admin@example.com", mfaEnabled: false });
      mockedUpdate.mockResolvedValue({});
      await startMfaEnrollment("user-1");
      const storedCiphertext = mockedUpdate.mock.calls[0][0].data.mfaSecretCiphertext;

      mockedFindUnique.mockResolvedValue({
        id: "user-1",
        mfaEnabled: false,
        mfaSecretCiphertext: storedCiphertext,
      });

      await expect(confirmMfaEnrollment("user-1", "000000")).rejects.toMatchObject({ code: "INVALID_CODE" });
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "MFA_ENROLLMENT_CONFIRM_FAILED", outcome: "FAILURE" })
      );
    });

    it("throws NOT_STARTED when there's no pending secret", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", mfaEnabled: false, mfaSecretCiphertext: null });

      await expect(confirmMfaEnrollment("user-1", "123456")).rejects.toMatchObject({ code: "NOT_STARTED" });
    });

    it("throws ALREADY_ENROLLED when MFA is already enabled", async () => {
      mockedFindUnique.mockResolvedValue({ id: "user-1", mfaEnabled: true, mfaSecretCiphertext: "x:y:z" });

      await expect(confirmMfaEnrollment("user-1", "123456")).rejects.toMatchObject({ code: "ALREADY_ENROLLED" });
    });
  });
});
