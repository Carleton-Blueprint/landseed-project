import { POST } from "../route";
import { prisma } from "lib/prisma";
import { consumeAuthEmailToken } from "@/backend/auth/authEmailToken";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import { AuthEmailTokenPurpose } from "@prisma/client";

jest.mock("lib/prisma", () => ({
  prisma: {
    authEmailToken: {
      findFirst: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailToken", () => ({
  hashAuthEmailToken: (t: string) => `hashed-${t}`,
  consumeAuthEmailToken: jest.fn(),
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueAuthEmail: jest.fn(),
}));

describe("POST /api/profile/change-email/verify", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when body validation fails", async () => {
    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "" }), // missing step
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid/non-existent token", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "invalid-token", step: "current" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid" });
  });

  it("returns 400 when token is already used", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-123",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    });

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "some-token", step: "current" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "already_used" });
  });

  it("returns 400 when token is expired", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-123",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000), // in the past
    });

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "some-token", step: "current" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  it("returns 400 when token purpose mismatch", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-123",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW, // mismatch for step=current
    });

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "some-token", step: "current" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid" });
  });

  it("completes step=current and sends second token to pendingEmail", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-123",
      userId: "user-123",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT,
      user: {
        id: "user-123",
        name: "Alice",
        pendingEmail: "new@example.com",
      },
    });

    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: true });

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "current-token", step: "current" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      step: "current",
      pendingEmail: "new@example.com",
    });

    expect(consumeAuthEmailToken).toHaveBeenCalledWith("current-token", AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT);
    expect(enqueueAuthEmail).toHaveBeenCalledWith({
      userId: "user-123",
      recipientEmail: "new@example.com",
      recipientName: "Alice",
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW,
    });
  });

  it("completes step=new and updates primary email address in the database", async () => {
    (prisma.authEmailToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-456",
      userId: "user-123",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_NEW,
      user: {
        id: "user-123",
        name: "Alice",
        pendingEmail: "new@example.com",
      },
    });

    (consumeAuthEmailToken as jest.Mock).mockResolvedValue({ ok: true });

    const request = new Request("http://localhost:3000/api/profile/change-email/verify", {
      method: "POST",
      body: JSON.stringify({ token: "new-token", step: "new" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      step: "new",
      email: "new@example.com",
    });

    expect(consumeAuthEmailToken).toHaveBeenCalledWith("new-token", AuthEmailTokenPurpose.EMAIL_CHANGE_NEW);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-123" },
      data: {
        email: "new@example.com",
        pendingEmail: null,
      },
    });
  });
});
