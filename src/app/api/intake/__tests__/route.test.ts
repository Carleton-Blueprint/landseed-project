import { POST } from "../route";
import { prisma } from "lib/prisma";
import { hashPassword } from "@/backend/auth/password";
import { enqueueEmailVerificationIfNeeded } from "@/backend/auth/authEmailNotification";
import { enforceRateLimit } from "@/backend/auth/rateLimit";

jest.mock("lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/backend/auth/password", () => ({
  hashPassword: jest.fn(),
  validatePasswordStrength: jest.fn(() => null),
}));

jest.mock("@/backend/auth/authEmailNotification", () => ({
  enqueueEmailVerificationIfNeeded: jest.fn(),
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  enforceRateLimit: jest.fn(),
}));

const request = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/intake", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (enforceRateLimit as jest.Mock).mockResolvedValue({ response: null });
    (hashPassword as jest.Mock).mockResolvedValue("hashed");
    (enqueueEmailVerificationIfNeeded as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns 429 when the rate limit is hit, without touching the database", async () => {
    const limited = new Response(JSON.stringify({ error: "Too many submissions." }), {
      status: 429,
      headers: { "Retry-After": "3600" },
    });
    (enforceRateLimit as jest.Mock).mockResolvedValue({ response: limited });

    const res = await POST(request({ email: "a@example.com", password: "Password1!" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("creates the user when under the rate limit", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({
      id: "user-1",
      name: "Jane",
      email: "a@example.com",
      phone: null,
    });

    const res = await POST(
      request({ name: "Jane", email: "a@example.com", password: "Password1!" })
    );

    expect(res.status).toBe(200);
    expect(prisma.user.create).toHaveBeenCalled();
  });
});
