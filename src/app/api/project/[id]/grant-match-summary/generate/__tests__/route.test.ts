import { POST } from "../route";
import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { generateAndStoreGrantMatchSummaryDocument } from "@/backend/services/grantMatchSummaryDocument";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("@/backend/services/grantMatchSummaryDocument", () => ({
  generateAndStoreGrantMatchSummaryDocument: jest.fn(),
}));

describe("POST /api/project/[id]/grant-match-summary/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(401);
    expect(generateAndStoreGrantMatchSummaryDocument).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks EDITOR access", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(403);
    expect(generateAndStoreGrantMatchSummaryDocument).not.toHaveBeenCalled();
  });

  it("forces regeneration and returns the result on success", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (generateAndStoreGrantMatchSummaryDocument as jest.Mock).mockResolvedValue({
      documentId: "doc-1",
      projectId: "proj-1",
      s3Key: "projects/proj-1/grant-match-summary/grant-match-summary-v2.pdf",
      fileName: "grant-match-summary-v2.pdf",
      regenerated: true,
    });

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(200);
    expect(generateAndStoreGrantMatchSummaryDocument).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", actorUserId: "user-1", force: true })
    );
    const data = await res.json();
    expect(data).toEqual(expect.objectContaining({ success: true, documentId: "doc-1" }));
  });

  it("returns 404 when the project does not exist", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (generateAndStoreGrantMatchSummaryDocument as jest.Mock).mockRejectedValue(new Error("Project not found"));

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the project has no eligibility assessment yet", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (generateAndStoreGrantMatchSummaryDocument as jest.Mock).mockRejectedValue(
      new Error("No eligibility assessment found for project")
    );

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(409);
  });

  it("returns 500 on unexpected errors", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (generateAndStoreGrantMatchSummaryDocument as jest.Mock).mockRejectedValue(new Error("S3 unavailable"));

    const req = new NextRequest("http://localhost/api/project/proj-1/grant-match-summary/generate", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "proj-1" }) });

    expect(res.status).toBe(500);
  });
});
