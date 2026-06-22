import { POST } from "../route";
import { auth } from "@/auth";
import { ensureShellProject } from "@/backend/services/intakeDraft";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/services/intakeDraft", () => ({
  ensureShellProject: jest.fn(),
}));

describe("POST /api/intake-draft/shell-project", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
  });

  it("creates a shell project when needed", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (ensureShellProject as jest.Mock).mockResolvedValue({
      draft: { id: "draft-1" },
      project: { id: "project-1" },
    });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(ensureShellProject).toHaveBeenCalledWith("user-1");
    expect(await res.json()).toEqual({
      draftId: "draft-1",
      projectId: "project-1",
    });
  });

  it("returns existing shell project idempotently", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (ensureShellProject as jest.Mock).mockResolvedValue({
      draft: { id: "draft-1" },
      project: { id: "project-1" },
    });

    const first = await POST();
    const second = await POST();

    expect((await first.json()).projectId).toBe("project-1");
    expect((await second.json()).projectId).toBe("project-1");
    expect(ensureShellProject).toHaveBeenCalledTimes(2);
  });
});
