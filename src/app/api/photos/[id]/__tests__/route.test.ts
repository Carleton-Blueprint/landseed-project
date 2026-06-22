import { DELETE } from "../route";
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
    },
  },
}));

jest.mock("lib/s3", () => ({
  deleteObjectFromS3: jest.fn(),
}));

describe("DELETE /api/photos/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const res = await DELETE(new Request("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when photo does not exist", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await DELETE(new Request("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 when project is not a draft", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      url: "https://bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/a.jpg",
      projectId: "project-1",
      project: { status: "submitted" },
    });

    const res = await DELETE(new Request("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(403);
  });

  it("deletes the photo when user has editor access", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (prisma.photo.findUnique as jest.Mock).mockResolvedValue({
      id: "photo-1",
      url: "https://bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/a.jpg",
      projectId: "project-1",
      project: { status: "draft" },
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (deleteObjectFromS3 as jest.Mock).mockResolvedValue(undefined);
    (prisma.photo.delete as jest.Mock).mockResolvedValue({ id: "photo-1" });

    const res = await DELETE(new Request("http://localhost/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(res.status).toBe(200);
    expect(deleteObjectFromS3).toHaveBeenCalledWith("projects/p1/photos/a.jpg");
    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: "photo-1" } });
    expect(await res.json()).toEqual({ success: true, photoId: "photo-1" });
  });
});
