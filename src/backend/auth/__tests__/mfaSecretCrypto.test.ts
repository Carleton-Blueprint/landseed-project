/**
 * @jest-environment node
 */
import { randomBytes } from "node:crypto";
import {
  encryptMfaSecret,
  decryptMfaSecret,
  MfaEncryptionKeyMissingError,
  MfaSecretCiphertextInvalidError,
} from "../mfaSecretCrypto";

const ORIGINAL_KEY = process.env.MFA_ENCRYPTION_KEY;

describe("mfaSecretCrypto", () => {
  beforeEach(() => {
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.MFA_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const ciphertext = encryptMfaSecret(secret);
    expect(ciphertext).not.toEqual(secret);
    expect(decryptMfaSecret(ciphertext)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    expect(encryptMfaSecret(secret)).not.toEqual(encryptMfaSecret(secret));
  });

  it("throws MfaEncryptionKeyMissingError when the env var is unset", () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    expect(() => encryptMfaSecret("secret")).toThrow(MfaEncryptionKeyMissingError);
  });

  it("throws MfaEncryptionKeyMissingError when the env var isn't 32 bytes", () => {
    process.env.MFA_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptMfaSecret("secret")).toThrow(MfaEncryptionKeyMissingError);
  });

  it("throws MfaSecretCiphertextInvalidError on malformed stored ciphertext", () => {
    expect(() => decryptMfaSecret("not-the-right-shape")).toThrow(MfaSecretCiphertextInvalidError);
  });

  it("fails to decrypt if the ciphertext was tampered with (GCM auth tag check)", () => {
    const ciphertext = encryptMfaSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
    const [iv, authTag, body] = ciphertext.split(":");
    const tamperedBody = Buffer.from(body, "base64");
    tamperedBody[0] ^= 0xff;
    const tampered = [iv, authTag, tamperedBody.toString("base64")].join(":");

    expect(() => decryptMfaSecret(tampered)).toThrow();
  });
});
