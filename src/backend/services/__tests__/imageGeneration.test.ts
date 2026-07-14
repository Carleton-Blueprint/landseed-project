import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url, uploadStreamToS3 } from "lib/s3";
import { getOpenAIClient } from "lib/openai";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import {
  buildAccessibilityVisualEditPrompt,
  modificationItemsFromDraft,
  generateAccessibilityVisual,
  processAccessibilityImageGenerationJob,
  buildAccessibilityRenditionS3Key,
} from "../imageGeneration";

jest.mock("openai", () => ({
  toFile: jest.fn(async (buffer: Buffer, name: string, options: { type: string }) => ({
    buffer,
    name,
    options,
  })),
}));

jest.mock("lib/openai", () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrlFromS3Url: jest.fn(),
  uploadStreamToS3: jest.fn(),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn().mockResolvedValue(undefined),
}));

const mockedPrisma = prisma as unknown as {
  photo: { findUnique: jest.Mock; update: jest.Mock };
};
const mockedGetSignedDownloadUrlFromS3Url = getSignedDownloadUrlFromS3Url as jest.Mock;
const mockedUploadStreamToS3 = uploadStreamToS3 as jest.Mock;
const mockedGetOpenAIClient = getOpenAIClient as jest.Mock;
const mockedLogAuditEventNonBlocking = logAuditEventNonBlocking as jest.Mock;

describe("buildAccessibilityVisualEditPrompt", () => {
  it("describes the requested modifications by label", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["GRAB_BARS", "WALK_IN_SHOWER"]);
    expect(prompt).toContain("Grab Bars, Walk-In Shower");
  });

  it("falls back to a generic description when no codes are given", () => {
    const prompt = buildAccessibilityVisualEditPrompt([]);
    expect(prompt).toContain("general accessibility improvements");
  });

  it("humanizes unknown codes", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["CUSTOM_RAMP"]);
    expect(prompt).toContain("CUSTOM RAMP");
  });
});

describe("modificationItemsFromDraft", () => {
  it("returns an empty array for null/non-object draftData", () => {
    expect(modificationItemsFromDraft(null)).toEqual([]);
    expect(modificationItemsFromDraft("not-an-object")).toEqual([]);
    expect(modificationItemsFromDraft(["array", "data"])).toEqual([]);
  });

  it("returns an empty array when modificationItems is missing or not an array", () => {
    expect(modificationItemsFromDraft({})).toEqual([]);
    expect(modificationItemsFromDraft({ modificationItems: "GRAB_BARS" })).toEqual([]);
  });

  it("filters to only string entries", () => {
    expect(
      modificationItemsFromDraft({ modificationItems: ["GRAB_BARS", 42, null, "STAIR_LIFT"] })
    ).toEqual(["GRAB_BARS", "STAIR_LIFT"]);
  });
});

describe("buildAccessibilityRenditionS3Key", () => {
  it("namespaces the key by project and photo id", () => {
    const key = buildAccessibilityRenditionS3Key("project-1", "photo-1");
    expect(key).toMatch(/^accessibility-renditions\/project-1\/photo-1-/);
    expect(key.endsWith(".png")).toBe(true);
  });
});

describe("generateAccessibilityVisual", () => {
  const originalFetch = global.fetch;
  let mockEdit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEdit = jest.fn();
    mockedGetOpenAIClient.mockReturnValue({ images: { edit: mockEdit } });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("source-image-bytes").buffer,
    }) as unknown as typeof fetch;

    mockedUploadStreamToS3.mockResolvedValue("https://bucket.s3.ca-central-1.amazonaws.com/accessibility-renditions/project-1/photo-1.png");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uploads the edited image to S3 and computes cost from token usage", async () => {
    mockEdit.mockResolvedValue({
      data: [{ b64_json: Buffer.from("rendered-image-bytes").toString("base64") }],
      usage: {
        output_tokens: 1000,
        input_tokens_details: { text_tokens: 500, image_tokens: 200 },
      },
    });

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
      ["GRAB_BARS"]
    );

    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-image-1", prompt: expect.stringContaining("Grab Bars") })
    );
    expect(mockedUploadStreamToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^accessibility-renditions\/project-1\/photo-1-/),
      "image/png",
      expect.any(Number)
    );
    // (500/1e6)*5 + (200/1e6)*10 + (1000/1e6)*40 = 0.0025 + 0.002 + 0.04 = 0.0445
    expect(result.costUsd).toBeCloseTo(0.0445, 6);
    expect(result.model).toBe("gpt-image-1");
    expect(result.s3Url).toContain("accessibility-renditions");
  });

  it("signs the source URL when it points at S3", async () => {
    mockedGetSignedDownloadUrlFromS3Url.mockResolvedValue("https://signed.example.com/original.png");
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    await generateAccessibilityVisual({
      id: "photo-1",
      projectId: "project-1",
      url: "https://bucket.s3.ca-central-1.amazonaws.com/original.png",
    });

    expect(mockedGetSignedDownloadUrlFromS3Url).toHaveBeenCalledWith(
      "https://bucket.s3.ca-central-1.amazonaws.com/original.png",
      300
    );
    expect(global.fetch).toHaveBeenCalledWith("https://signed.example.com/original.png");
  });

  it("throws when the source photo fails to download", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }) as unknown as typeof fetch;

    await expect(
      generateAccessibilityVisual({ id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" })
    ).rejects.toThrow(/Failed to download source photo photo-1/);
  });

  it("throws when OpenAI returns no image data", async () => {
    mockEdit.mockResolvedValue({ data: [{}] });

    await expect(
      generateAccessibilityVisual({ id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" })
    ).rejects.toThrow(/returned no image data/);
  });
});

describe("processAccessibilityImageGenerationJob", () => {
  const basePhoto = {
    id: "photo-1",
    projectId: "project-1",
    url: "https://example.com/original.png",
    project: { draftData: { modificationItems: ["GRAB_BARS"] } },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.photo.findUnique.mockResolvedValue(basePhoto);
    mockedPrisma.photo.update.mockResolvedValue({});

    mockedGetOpenAIClient.mockReturnValue({
      images: { edit: jest.fn().mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }) },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("source-image-bytes").buffer,
    }) as unknown as typeof fetch;

    mockedUploadStreamToS3.mockResolvedValue("https://bucket.s3.ca-central-1.amazonaws.com/accessibility-renditions/project-1/photo-1.png");
  });

  it("throws when the photo does not exist", async () => {
    mockedPrisma.photo.findUnique.mockResolvedValue(null);

    await expect(processAccessibilityImageGenerationJob({ photoId: "missing" })).rejects.toThrow(
      "Photo not found: missing"
    );
  });

  it("marks the photo READY and logs a SUCCESS audit event on success", async () => {
    await processAccessibilityImageGenerationJob({ photoId: "photo-1" });

    expect(mockedPrisma.photo.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "photo-1" }, data: { generationStatus: "GENERATING" } })
    );
    expect(mockedPrisma.photo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "photo-1" },
        data: expect.objectContaining({ generationStatus: "READY", generationError: null }),
      })
    );

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ category: "AI_GENERATION", outcome: "SUCCESS", resourceId: "photo-1" })
    );
  });

  it("marks the photo FAILED, preserves the prior image, and rethrows on failure", async () => {
    mockedGetOpenAIClient.mockReturnValue({
      images: { edit: jest.fn().mockRejectedValue(new Error("OpenAI rate limited")) },
    });

    await expect(processAccessibilityImageGenerationJob({ photoId: "photo-1" })).rejects.toThrow(
      "OpenAI rate limited"
    );

    const failureUpdateCall = mockedPrisma.photo.update.mock.calls.find(
      ([args]: [{ data: { generationStatus?: string } }]) => args.data.generationStatus === "FAILED"
    );
    expect(failureUpdateCall).toBeDefined();
    expect(failureUpdateCall![0].data).toEqual({
      generationStatus: "FAILED",
      generationError: "OpenAI rate limited",
    });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ category: "AI_GENERATION", outcome: "FAILURE", resourceId: "photo-1" })
    );
  });
});
