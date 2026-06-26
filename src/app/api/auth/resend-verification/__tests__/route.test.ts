import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { enqueueEmailVerificationIfNeeded } from "@/backend/auth/authEmailNotification";
import { checkRateLimit } from "@/backend/auth/rateLimit";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueEmailVerificationIfNeeded: jest.fn(),
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  buildRateLimitKey: jest.fn((scope: string, id: string) => `${scope}:${id}`),
  checkRateLimit: jest.fn(),
}));

describe("POST /api/auth/resend-verification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const response = await POST(new NextRequest("http://localhost:3000/api/auth/resend-verification", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
  });

  it("enqueues a verification email for unverified users", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "Alex",
      emailVerified: null,
    });

    const response = await POST(new NextRequest("http://localhost:3000/api/auth/resend-verification", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(enqueueEmailVerificationIfNeeded).toHaveBeenCalledWith({
      userId: "user-1",
      recipientEmail: "user@example.com",
      recipientName: "Alex",
      emailVerified: null,
    });
  });

  it("returns success without enqueueing when already verified", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "Alex",
      emailVerified: new Date(),
    });

    const response = await POST(new NextRequest("http://localhost:3000/api/auth/resend-verification", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(enqueueEmailVerificationIfNeeded).not.toHaveBeenCalled();
  });
});
