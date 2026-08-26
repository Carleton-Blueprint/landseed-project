import { NextRequest } from "next/server";
import { AuthEmailTokenPurpose } from "@prisma/client";
import { GET, POST, DELETE } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { enqueueEmailChangeVerification } from "@/backend/auth/authEmailNotification";
import { checkRateLimit } from "@/backend/auth/rateLimit";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    authEmailToken: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueEmailChangeVerification: jest.fn(),
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  buildRateLimitKey: jest.fn((scope: string, id: string) => `${scope}:${id}`),
  checkRateLimit: jest.fn(),
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/account/email-change", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/account/email-change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const response = await POST(postRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(401);
  });

  it("returns 400 for an invalid email", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });

    const response = await POST(postRequest({ newEmail: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const response = await POST(postRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(429);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("returns 400 when the new email matches the current email", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      email: "current@example.com",
      name: "Alex",
    });

    const response = await POST(postRequest({ newEmail: "Current@Example.com" }));

    expect(response.status).toBe(400);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("returns 409 when the new email is already in use", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ email: "current@example.com", name: "Alex" })
      .mockResolvedValueOnce({ id: "other-user" });

    const response = await POST(postRequest({ newEmail: "taken@example.com" }));

    expect(response.status).toBe(409);
    expect(enqueueEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("enqueues the old-email verification and logs an audit event on success", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({ email: "current@example.com", name: "Alex" })
      .mockResolvedValueOnce(null);

    const response = await POST(postRequest({ newEmail: "new@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "A verification link has been sent to your current email address.",
    });
    expect(enqueueEmailChangeVerification).toHaveBeenCalledWith({
      userId: "user-1",
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
      newEmail: "new@example.com",
      recipientEmail: "current@example.com",
      recipientName: "Alex",
    });
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMAIL_CHANGE_REQUESTED",
        outcome: "SUCCESS",
        actorUserId: "user-1",
      })
    );
  });
});

describe("GET /api/account/email-change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns null pendingEmail when there is no active token", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendingEmail: null });
  });

  it("returns the pending email from the most recent active token", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      newEmail: "new@example.com",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendingEmail: "new@example.com" });
    expect(prisma.authEmailToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          purpose: {
            in: [
              AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
              AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
            ],
          },
          usedAt: null,
        }),
      })
    );
  });
});

function deleteRequest() {
  return new NextRequest("http://localhost:3000/api/account/email-change", {
    method: "DELETE",
  });
}

describe("DELETE /api/account/email-change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(401);
    expect(prisma.authEmailToken.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes pending tokens and logs an audit event on success", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.authEmailToken.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(prisma.authEmailToken.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        purpose: {
          in: [
            AuthEmailTokenPurpose.EMAIL_CHANGE_OLD_CONFIRM,
            AuthEmailTokenPurpose.EMAIL_CHANGE_NEW_CONFIRM,
          ],
        },
        usedAt: null,
      },
    });
    expect(logAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EMAIL_CHANGE_CANCELLED",
        outcome: "SUCCESS",
        actorUserId: "user-1",
      })
    );
  });
});
