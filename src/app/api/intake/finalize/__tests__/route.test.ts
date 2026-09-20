import { POST } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { finalizeIntake } from "@/backend/services/finalizeIntake";
import { enforceDualRateLimit } from "@/backend/auth/rateLimit";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/backend/services/finalizeIntake", () => ({
  finalizeIntake: jest.fn(),
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  enforceDualRateLimit: jest.fn(),
}));

const request = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/intake/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/intake/finalize", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (enforceDualRateLimit as jest.Mock).mockResolvedValue({ response: null });
  });

  it("checks auth before rate limiting, and rate-limits by account id", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (finalizeIntake as jest.Mock).mockResolvedValue({ ok: true, status: "submitted" });

    await POST(request({ projectId: "project-1" }));

    expect(auth).toHaveBeenCalled();
    expect(enforceDualRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "intake-finalize", accountId: "user-1" })
    );
  });

  it("falls back to IP-only rate limiting (accountId: null) when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    await POST(request({ projectId: "project-1" }));

    expect(enforceDualRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "intake-finalize", accountId: null })
    );
  });

  it("returns 429 when the rate limit is hit", async () => {
    const limited = new Response(JSON.stringify({ error: "Too many submissions." }), {
      status: 429,
      headers: { "Retry-After": "3600" },
    });
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (enforceDualRateLimit as jest.Mock).mockResolvedValue({ response: limited });

    const res = await POST(request({ projectId: "project-1" }));

    expect(res.status).toBe(429);
    expect(finalizeIntake).not.toHaveBeenCalled();
  });

  it("finalizes the project when under the rate limit and authorized", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (finalizeIntake as jest.Mock).mockResolvedValue({ ok: true, status: "submitted" });

    const res = await POST(request({ projectId: "project-1" }));

    expect(res.status).toBe(200);
    expect(finalizeIntake).toHaveBeenCalled();
  });
});
