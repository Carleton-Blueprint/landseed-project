import { NextRequest } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { GET } from "../route";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { prisma } from "lib/prisma";
import { enqueueEmailChangeVerification } from "@/backend/auth/authEmailNotification";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

jest.mock("@/backend/auth/authEmailToken", () => ({
  consumeAuthEmailToken: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueEmailChangeVerification: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

function getRequest(url: string) {
  return new NextRequest(url, { headers: { accept: "application/json" } });
}

describe("GET /api/account/email-change/verify-old", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 JSON when token is missing", async () => {
    const response = await GET(getRequest("http://localhost:3000/api/account/email-change/verify-old"));
    expect(response.status).toBe(400);
  });

  it("returns 400 when the token is expired", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: false, reason: "expired" });

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-old?token=expired")
    );

    expect(response.status).toBe(400);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("returns 409 and logs a failure when the new email was claimed in the meantime", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
      newEmail: "new@example.com",
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ name: "Alex" })
      .mockResolvedValueOnce({ id: "other-user" });

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-old?token=valid")
    );

    expect(response.status).toBe(409);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EMAIL_CHANGE_OLD_EMAIL_VERIFIED", outcome: "FAILURE" })
    );
  });

  it("enqueues the new-email verification and logs success", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({
      ok: true,
      tokenId: "token-1",
      userId: "user-1",
      newEmail: "new@example.com",
    });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ name: "Alex" })
      .mockResolvedValueOnce(null);

    const response = await GET(
      getRequest("http://localhost:3000/api/account/email-change/verify-old?token=valid")
    );

    expect(response.status).toBe(200);
    expect(enqueueEmailChangeVerification).toHaveBeenCalledWith({
      userId: "user-1",
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
      newEmail: "new@example.com",
      recipientEmail: "new@example.com",
      recipientName: "Alex",
    });
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EMAIL_CHANGE_OLD_EMAIL_VERIFIED", outcome: "SUCCESS" })
    );
  });

  it("redirects browsers to /profile with a status query param", async () => {
    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: false, reason: "already_used" });

    const request = new NextRequest(
      "http://localhost:3000/api/account/email-change/verify-old?token=used",
      { headers: { accept: "text/html" } }
    );

    const response = await GET(request);

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile?emailChange=used"
    );
  });
});
