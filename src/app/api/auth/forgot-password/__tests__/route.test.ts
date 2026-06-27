import { NextRequest } from "next/server";
import { POST } from "../route";
import { prisma } from "lib/prisma";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import { checkRateLimit } from "@/backend/auth/rateLimit";
import { GENERIC_AUTH_EMAIL_RESPONSE } from "@/backend/auth/authEmailResponses";

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueAuthEmail: jest.fn(),
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  buildRateLimitKey: jest.fn((scope: string, id: string) => `${scope}:${id}`),
  checkRateLimit: jest.fn(),
}));

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  });

  it("returns a generic response even when email is missing from payload", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("enqueues reset email for known accounts but still returns generic response", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "Alex",
      passwordHash: "hash",
    });

    const request = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(GENERIC_AUTH_EMAIL_RESPONSE);
    expect(enqueueAuthEmail).toHaveBeenCalled();
  });

  it("does not reveal whether the account exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(GENERIC_AUTH_EMAIL_RESPONSE);
    expect(enqueueAuthEmail).not.toHaveBeenCalled();
  });
});
