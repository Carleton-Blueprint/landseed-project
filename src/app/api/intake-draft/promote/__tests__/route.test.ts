import { POST } from "../route";
import { auth } from "@/auth";
import { promoteIntakeDraft } from "@/backend/services/intakeDraft";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/services/intakeDraft", () => ({
  promoteIntakeDraft: jest.fn(),
}));

jest.mock("@/backend/auth/requireVerifiedEmail", () => ({
  requireVerifiedEmail: jest.fn(),
}));

import { requireVerifiedEmail, EmailVerificationRequiredError } from "@/backend/auth/requireVerifiedEmail";

describe("POST /api/intake-draft/promote", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireVerifiedEmail as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await POST(new Request("http://localhost/api/intake-draft/promote"));

    expect(res.status).toBe(401);
  });

  it("returns 403 when email is not verified", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (requireVerifiedEmail as jest.Mock).mockRejectedValue(new EmailVerificationRequiredError());

    const res = await POST(new Request("http://localhost/api/intake-draft/promote"));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(promoteIntakeDraft).not.toHaveBeenCalled();
  });

  it("returns 422 when intake data is incomplete", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (promoteIntakeDraft as jest.Mock).mockResolvedValue({
      ok: false,
      code: "INCOMPLETE_INTAKE",
      message: "Intake data is incomplete or invalid.",
    });

    const res = await POST(new Request("http://localhost/api/intake-draft/promote"));

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("INCOMPLETE_INTAKE");
  });

  it("promotes the draft and calls finalize via service", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (promoteIntakeDraft as jest.Mock).mockResolvedValue({
      ok: true,
      projectId: "project-1",
      status: "submitted",
      message: "Intake finalized successfully.",
    });

    const res = await POST(
      new Request("http://localhost/api/intake-draft/promote", {
        headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "jest" },
      })
    );

    expect(res.status).toBe(200);
    expect(promoteIntakeDraft).toHaveBeenCalledWith("user-1", {
      actorUserId: "user-1",
      ipAddress: "127.0.0.1",
      userAgent: "jest",
    });

    const data = await res.json();
    expect(data.projectId).toBe("project-1");
    expect(data.status).toBe("submitted");
  });
});
