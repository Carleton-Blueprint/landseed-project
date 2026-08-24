import { GET } from "../route";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
    photo: {
      update: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrlFromS3Url: jest.fn(),
}));

// The handler under test never touches NextRequest-specific fields
// (cookies, nextUrl, etc.), so a plain Request is safe to pass through.
function makeRequest(projectId: string) {
  return {
    request: new Request(`http://localhost/api/project/${projectId}/visualization`) as unknown as NextRequest,
    params: Promise.resolve({ id: projectId }),
  };
}

describe("GET /api/project/[id]/visualization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
  });

  it("returns 401 when unsigned", async () => {
    (auth as jest.Mock).mockResolvedValue(null);

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });

    expect(res.status).toBe(401);
  });

  it("returns 404 when the project does not exist", async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue(null);

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the user lacks project access", async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      photos: [],
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(false);

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });

    expect(res.status).toBe(403);
  });

  it("signs and returns the stored rendition when generation is READY", async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      photos: [
        {
          id: "photo-1",
          url: "https://example.com/original.png",
          generationStatus: "READY",
          generatedImageUrl: "https://test-account.r2.cloudflarestorage.com/test-bucket/accessibility-renditions/project-1/photo-1.png",
          declaredModificationCodes: ["GRAB_BARS"],
        },
      ],
    });
    (getSignedDownloadUrlFromS3Url as jest.Mock).mockResolvedValue("https://signed.example.com/rendition.png");

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.photos[0].generatedImageUrl).toBe("https://signed.example.com/rendition.png");
  });

  it("returns null generatedImageUrl when generation is pending", async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      photos: [
        { id: "photo-1", url: "https://example.com/original.png", generationStatus: "PENDING", generatedImageUrl: null },
      ],
    });

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(body.photos[0].generatedImageUrl).toBeNull();
  });

  it("serves the worker's persisted mock fallback image when live generation failed after retries", async () => {
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      photos: [
        {
          id: "photo-1",
          url: "https://example.com/original.png",
          generationStatus: "FAILED",
          generatedImageUrl: "https://placehold.co/900x600?text=Mock+AI+Visual",
        },
      ],
    });

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(body.photos[0].generatedImageUrl).toBe("https://placehold.co/900x600?text=Mock+AI+Visual");
  });
});
