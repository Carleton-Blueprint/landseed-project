import { Session } from "next-auth";
import { prisma } from "lib/prisma";
import {
  EmailVerificationRequiredError,
  EMAIL_VERIFICATION_REQUIRED_CODE,
  hasVerifiedEmail,
  isEmailVerificationEnforced,
  requireVerifiedEmail,
} from "@/backend/auth/requireVerifiedEmail";
import { HttpError } from "@/backend/auth/requireRole";
import { authGateResponse } from "@/backend/auth/authGateResponse";

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/devBypass", () => ({
  isDevAuthBypassEnabled: jest.fn(),
}));

import { isDevAuthBypassEnabled } from "@/backend/auth/devBypass";

const session = { user: { id: "user-1", email: "user@example.com" } } as Session;

describe("requireVerifiedEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isDevAuthBypassEnabled as jest.Mock).mockReturnValue(false);
  });

  it("skips verification when dev auth bypass is enabled", async () => {
    (isDevAuthBypassEnabled as jest.Mock).mockReturnValue(true);

    await expect(requireVerifiedEmail(session)).resolves.toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws when the user email is not verified", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      email: "user@example.com",
      emailVerified: null,
    });

    await expect(requireVerifiedEmail(session)).rejects.toBeInstanceOf(
      EmailVerificationRequiredError
    );
  });

  it("allows verified users through", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      email: "user@example.com",
      emailVerified: new Date(),
    });

    await expect(requireVerifiedEmail(session)).resolves.toBeUndefined();
  });

  it("returns a structured 403 response for verification errors", async () => {
    const error = new EmailVerificationRequiredError();
    const response = authGateResponse(error);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: error.message,
      code: EMAIL_VERIFICATION_REQUIRED_CODE,
    });
  });

  it("treats accounts without email as verified", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: null, emailVerified: null });
    await expect(hasVerifiedEmail("user-1")).resolves.toBe(true);
    expect(isEmailVerificationEnforced()).toBe(true);
  });

  it("throws unauthenticated for missing session", async () => {
    await expect(requireVerifiedEmail(null)).rejects.toBeInstanceOf(HttpError);
  });
});
