import { GET } from "../route";
import { auth } from "@/auth";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import { isLiveImageGenerationEnabled } from "lib/openai";
import { generateMockAccessibilityVisual } from "@/backend/services/imageGeneration";

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
  },
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrlFromS3Url: jest.fn(),
}));

jest.mock("lib/openai", () => ({
  isLiveImageGenerationEnabled: jest.fn(),
}));

jest.mock("@/backend/services/imageGeneration", () => {
  const actual = jest.requireActual("@/backend/services/imageGeneration");
  return {
    ...actual,
    generateMockAccessibilityVisual: jest.fn(),
  };
});

function makeRequest(projectId: string) {
  return {
    request: new Request(`http://localhost/api/project/${projectId}/visualization`),
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
      draftData: {},
      photos: [],
    });
    (hasProjectAccess as jest.Mock).mockResolvedValue(false);

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });

    expect(res.status).toBe(403);
  });

  it("signs and returns the stored rendition when generation is READY", async () => {
    (isLiveImageGenerationEnabled as jest.Mock).mockReturnValue(true);
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      draftData: { modificationItems: ["GRAB_BARS"] },
      photos: [
        {
          id: "photo-1",
          url: "https://example.com/original.png",
          generationStatus: "READY",
          generatedImageUrl: "https://bucket.s3.ca-central-1.amazonaws.com/accessibility-renditions/project-1/photo-1.png",
        },
      ],
    });
    (getSignedDownloadUrlFromS3Url as jest.Mock).mockResolvedValue("https://signed.example.com/rendition.png");

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.photos[0].generatedImageUrl).toBe("https://signed.example.com/rendition.png");
    expect(generateMockAccessibilityVisual).not.toHaveBeenCalled();
  });

  it("returns null generatedImageUrl (no mock fallback) when live generation is enabled but not ready", async () => {
    (isLiveImageGenerationEnabled as jest.Mock).mockReturnValue(true);
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      draftData: {},
      photos: [
        { id: "photo-1", url: "https://example.com/original.png", generationStatus: "PENDING", generatedImageUrl: null },
      ],
    });

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(body.photos[0].generatedImageUrl).toBeNull();
    expect(generateMockAccessibilityVisual).not.toHaveBeenCalled();
  });

  it("falls back to the mock placeholder when live generation is disabled", async () => {
    (isLiveImageGenerationEnabled as jest.Mock).mockReturnValue(false);
    (generateMockAccessibilityVisual as jest.Mock).mockResolvedValue("https://placehold.co/900x600?text=Mock");
    (prisma.project.findUnique as jest.Mock).mockResolvedValue({
      id: "project-1",
      draftData: {},
      photos: [
        { id: "photo-1", url: "https://example.com/original.png", generationStatus: "PENDING", generatedImageUrl: null },
      ],
    });

    const { request, params } = makeRequest("project-1");
    const res = await GET(request, { params });
    const body = await res.json();

    expect(body.photos[0].generatedImageUrl).toBe("https://placehold.co/900x600?text=Mock");
  });
});
