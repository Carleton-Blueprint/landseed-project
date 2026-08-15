import { POST } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { enqueueAuthEmail } from "@/backend/auth/authEmailNotification";
import { AuthEmailTokenPurpose } from "@prisma/client";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    authEmailToken: {
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueAuthEmail: jest.fn(),
}));

describe("POST /api/profile/change-email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/profile/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "test@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 for invalid email format", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-123" } });

    const request = new Request("http://localhost:3000/api/profile/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "invalid-email" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid email format" });
  });

  it("returns 400 when new email is the same as current email", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-123", email: "current@example.com" } });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-123",
      email: "current@example.com",
      name: "Test User",
    });

    const request = new Request("http://localhost:3000/api/profile/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "current@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "New email must be different from current email address" });
  });

  it("returns 400 when new email is already in use by another user", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-123", email: "current@example.com" } });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: "user-123",
        email: "current@example.com",
      })
      .mockResolvedValueOnce({
        id: "user-456",
        email: "inuse@example.com",
      });

    const request = new Request("http://localhost:3000/api/profile/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "inuse@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This email address is already in use" });
  });

  it("successfully sets pendingEmail and enqueues EMAIL_CHANGE_CURRENT verification link", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-123", email: "current@example.com" } });
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: "user-123",
        email: "current@example.com",
        name: "Alice",
      }) // user.findUnique for the authenticated user
      .mockResolvedValueOnce(null); // user.findUnique to check if newEmail is in use

    const request = new Request("http://localhost:3000/api/profile/change-email", {
      method: "POST",
      body: JSON.stringify({ newEmail: "new@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, pendingEmail: "new@example.com" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-123" },
      data: { pendingEmail: "new@example.com" },
    });

    expect(prisma.authEmailToken.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-123",
        purpose: {
          in: [AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT, AuthEmailTokenPurpose.EMAIL_CHANGE_NEW],
        },
        usedAt: null,
      },
    });

    expect(enqueueAuthEmail).toHaveBeenCalledWith({
      userId: "user-123",
      recipientEmail: "current@example.com",
      recipientName: "Alice",
      purpose: AuthEmailTokenPurpose.EMAIL_CHANGE_CURRENT,
    });
  });
});
