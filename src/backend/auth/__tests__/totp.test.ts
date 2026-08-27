/**
 * @jest-environment node
 */
import { generate } from "otplib";
import { generateTotpSecret, buildTotpProvisioningUri, verifyTotpToken } from "../totp";

describe("totp", () => {
  it("generates a secret usable for both token generation and verification", async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });

    expect(await verifyTotpToken(secret, token)).toBe(true);
  });

  it("rejects an incorrect token", async () => {
    const secret = generateTotpSecret();
    const wrongToken = "000000";

    // Vanishingly unlikely to collide with the real code; if this ever
    // flakes, the fix is a fixed-secret fixture, not a broader tolerance.
    const realToken = await generate({ secret });
    expect(wrongToken === realToken).toBe(false);
    expect(await verifyTotpToken(secret, wrongToken)).toBe(false);
  });

  it("accepts a correct token containing an internal space", async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });
    const spacedToken = `${token.slice(0, 3)} ${token.slice(3)}`;

    expect(await verifyTotpToken(secret, spacedToken)).toBe(true);
  });

  it("resolves non-digit input to invalid rather than throwing", async () => {
    const secret = generateTotpSecret();

    await expect(verifyTotpToken(secret, "12x 456")).resolves.toBe(false);
  });

  it("builds an otpauth:// URI with the LandSeed issuer and account label", () => {
    const secret = generateTotpSecret();
    const uri = buildTotpProvisioningUri(secret, "admin@example.com");

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent("LandSeed InPlace"));
    expect(uri).toContain(encodeURIComponent("admin@example.com"));
  });
});
