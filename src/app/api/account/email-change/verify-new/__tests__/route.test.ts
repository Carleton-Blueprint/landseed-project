import { NextRequest } from "next/server";
import { GET } from "../route";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

jest.mock("@/backend/auth/authEmailToken", () => ({
  consumeAuthEmailToken: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

function getRequest(url: string) {
  return new NextRequest(url, { headers: { accept: "application/json" } });
}

describe("GET /api/account/email-change/verify-new", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 JSON when token is missing", async () => {
    const response = await GET(getRequest("http://localhost:3000/api/account/email-change/verify-new"));
    expect(response.status).toBe(400);
  });

  it("returns 400 when the token is invalid", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-new?token=bad")
    );

    expect(response.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("updates the user's email and marks it verified on success", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
      newEmail: "new@example.com",
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "old@example.com" });
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: "user-1", email: "new@example.com" });

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-new?token=valid")
    );

    expect(response.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@example.com", emailVerified: expect.any(Date) },
    });
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMAIL_CHANGE_COMPLETED",
        outcome: "SUCCESS",
        beforeState: { email: "old@example.com" },
        afterState: { email: "new@example.com" },
      })
    );
  });

  it("returns 409 and logs a failure when the email was claimed by another account at write time", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
      newEmail: "new@example.com",
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "old@example.com" });
    (prisma.user.update as jest.Mock).mockRejectedValue({ code: "P2002" });

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-new?token=valid")
    );

    expect(response.status).toBe(409);
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EMAIL_CHANGE_COMPLETED", outcome: "FAILURE" })
    );
  });

  it("redirects browsers to /profile with a status query param", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: false, reason: "expired" });

    const request = new NextRequest(
      "http://localhost:3000/api/account/email-change/verify-new?token=expired",
      { headers: { accept: "text/html" } }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile?emailChange=expired"
    );
  });
});
