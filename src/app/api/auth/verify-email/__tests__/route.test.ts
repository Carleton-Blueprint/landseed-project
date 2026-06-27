import { NextRequest } from "next/server";
import { GET } from "../route";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { prisma } from "lib/prisma";

jest.mock("@/backend/auth/authEmailToken", () => ({
  consumeAuthEmailToken: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      update: jest.fn(),
    },
  },
}));

describe("GET /api/auth/verify-email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 JSON when token is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/auth/verify-email", {
      headers: { accept: "application/json" },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "Token is required." });
  });

  it("marks the user verified when token is valid", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
    });
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: "user-1" });

    const request = new NextRequest(
      "http://localhost:3000/api/auth/verify-email?token=valid-token",
      { headers: { accept: "application/json" } }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Email verified successfully.",
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it("redirects browsers when verification fails", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: false,
      reason: "expired",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/auth/verify-email?token=expired-token",
      { headers: { accept: "text/html" } }
    );

    const response = await GET(request);
    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/auth/signin?verified=expired"
    );
  });
});
