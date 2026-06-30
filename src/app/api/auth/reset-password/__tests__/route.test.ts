import { NextRequest } from "next/server";
import { POST } from "../route";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { hashPassword } from "@/backend/auth/password";
import { prisma } from "lib/prisma";

jest.mock("@/backend/auth/authEmailToken", () => ({
  consumeAuthEmailToken: jest.fn(),
}));

jest.mock("@/backend/auth/password", () => ({
  hashPassword: jest.fn(),
  validatePasswordStrength: jest.fn(() => null),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      update: jest.fn(),
    },
  },
}));

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hashPassword as jest.Mock).mockResolvedValue("new-hash");
  });

  it("rejects invalid tokens", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: false,
      reason: "expired",
    });

    const request = new NextRequest("http://localhost:3000/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "expired", password: "password123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("updates the password when token is valid", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
    });

    const request = new NextRequest("http://localhost:3000/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "valid-token", password: "Password1!" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(hashPassword).toHaveBeenCalledWith("Password1!");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash" },
    });
  });
});
