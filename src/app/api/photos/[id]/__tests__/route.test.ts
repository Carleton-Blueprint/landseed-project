import { DELETE, PATCH } from "../route";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { prisma } from "lib/prisma";
import { deleteObjectFromS3 } from "lib/s3";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  deleteObjectFromS3: jest.fn(),
}));

// The handler under test never touches NextRequest-specific fields
// (cookies, nextUrl, etc.), so a plain Request is safe to pass through.
function buildRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function buildPatchRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("DELETE /api/photos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await DELETE(buildRequest("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when photo does not exist", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await DELETE(buildRequest("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 when project is not a draft", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      url: "https://test-account.r2.cloudflarestorage.com/test-bucket/projects/p1/photos/a.jpg",
      projectId: "project-1",
      project: { status: "SUBMITTED" },
    });

    const res = await DELETE(buildRequest("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(403);
  });

  it("deletes the photo when user has editor access", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      url: "https://test-account.r2.cloudflarestorage.com/test-bucket/projects/p1/photos/a.jpg",
      projectId: "project-1",
      project: { status: "DRAFT" },
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (deleteObjectFromS3 as jest.Mock).mockResolvedValue(undefined);
    (prisma.photo.delete as jest.Mock).mockResolvedValue({ id: "photo-1" });

    const res = await DELETE(buildRequest("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(200);
    expect(deleteObjectFromS3).toHaveBeenCalledWith("projects/p1/photos/a.jpg");
    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: "photo-1" } });
    expect(await res.json()).toEqual({ success: true, photoId: "photo-1" });
  });
});

describe("PATCH /api/photos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: [] }), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 when modificationItems is missing or not an array of strings", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });

    const res = await PATCH(buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: "GRAB_BARS" }), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(400);
    expect(prisma.photo.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown modification code", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: ["NOT_A_REAL_CODE"] }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(400);
    expect(prisma.photo.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when photo does not exist", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: ["GRAB_BARS"] }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 when project is not a draft", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      project: { status: "SUBMITTED" },
    });

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: ["GRAB_BARS"] }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(403);
    expect(hasProjectAccess).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks editor access", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      project: { status: "DRAFT" },
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(false);

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: ["GRAB_BARS"] }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(403);
    expect(prisma.photo.update).not.toHaveBeenCalled();
  });

  it("updates declared modification codes when the project is a draft and user is an editor", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      project: { status: "DRAFT" },
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (prisma.photo.update as jest.Mock).mockResolvedValue({
      id: "photo-1",
      declaredModificationCodes: ["GRAB_BARS", "HANDRAILS"],
    });

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", {
        modificationItems: ["GRAB_BARS", "HANDRAILS"],
      }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: "photo-1" },
      data: { declaredModificationCodes: ["GRAB_BARS", "HANDRAILS"] },
    });
    expect(await res.json()).toEqual({
      success: true,
      photo: { id: "photo-1", declaredModificationCodes: ["GRAB_BARS", "HANDRAILS"] },
    });
  });

  it("allows clearing all tags with an empty array", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      project: { status: "DRAFT" },
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (prisma.photo.update as jest.Mock).mockResolvedValue({
      id: "photo-1",
      declaredModificationCodes: [],
    });

    const res = await PATCH(
      buildPatchRequest("http://localhost/api/photos/photo-1", { modificationItems: [] }),
      { params: Promise.resolve({ id: "photo-1" }) }
    );

    expect(res.status).toBe(200);
    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: "photo-1" },
      data: { declaredModificationCodes: [] },
    });
  });
});
