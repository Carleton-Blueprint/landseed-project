/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth } from "@/auth";
import { prisma } from "lib/prisma";
import { uploadToS3 } from "lib/s3";
import { hasProjectAccess } from "@/backend/auth/projectAccess";
import { requireVerifiedEmail } from "@/backend/auth/requireVerifiedEmail";
import { virusScanQueue } from "@/backend/queue";
import { enforceRateLimit } from "@/backend/auth/rateLimit";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      create: jest.fn(),
    },
  },
}));

jest.mock("lib/s3", () => ({
  uploadToS3: jest.fn(),
}));

jest.mock("lib/photoUrls", () => ({
  signPhotoUrlForDisplay: jest.fn(async (url: string) => url),
}));

jest.mock("@/backend/auth/projectAccess", () => ({
  hasProjectAccess: jest.fn(),
}));

jest.mock("@/backend/auth/requireVerifiedEmail", () => ({
  requireVerifiedEmail: jest.fn(),
}));

jest.mock("@/backend/queue", () => ({
  virusScanQueue: { add: jest.fn() },
}));

jest.mock("@/backend/auth/rateLimit", () => ({
  enforceRateLimit: jest.fn(),
}));

function buildFormDataRequest(): NextRequest {
  const formData = new FormData();
  formData.set("file", new File(["x"], "photo.jpg", { type: "image/jpeg" }));
  formData.set("projectId", "project-1");
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: formData });
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (enforceRateLimit as jest.Mock).mockResolvedValue({ response: null });
    (requireVerifiedEmail as jest.Mock).mockResolvedValue(undefined);
  });

  it("returns 429 when the rate limit is hit, before checking auth", async () => {
    const limited = new Response(JSON.stringify({ error: "Too many uploads." }), {
      status: 429,
      headers: { "Retry-After": "3600" },
    });
    (enforceRateLimit as jest.Mock).mockResolvedValue({ response: limited });

    const res = await POST(buildFormDataRequest());

    expect(res.status).toBe(429);
    expect(auth).not.toHaveBeenCalled();
  });

  it("uploads the photo when under the rate limit and authorized", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1" } });
    (hasProjectAccess as jest.Mock).mockResolvedValue(true);
    (uploadToS3 as jest.Mock).mockResolvedValue("https://s3.example.com/photo.jpg");
    (prisma.photo.create as jest.Mock).mockResolvedValue({
      id: "photo-1",
      url: "https://s3.example.com/photo.jpg",
      projectId: "project-1",
      virus_scan_status: "pending",
    });
    (virusScanQueue.add as jest.Mock).mockResolvedValue(undefined);

    const res = await POST(buildFormDataRequest());

    expect(res.status).toBe(200);
    expect(prisma.photo.create).toHaveBeenCalled();
  });
});
