import sharp from "sharp";
import { prisma } from "lib/prisma";
import { getSignedDownloadUrlFromS3Url, uploadStreamToS3 } from "lib/s3";
import { getOpenAIClient } from "lib/openai";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import type { PlacementPlan } from "../imagePlacementPlanner";
import { DEFAULT_IMAGE_GENERATION_MODEL } from "../imageGenerationModelConfig";
import {
  ACCESSIBILITY_VISUAL_PROMPT_VERSION,
  buildAccessibilityVisualEditPrompt,
  buildPlacementPlanAuditMetadata,
  detectSourceImageType,
  generateAccessibilityVisual,
  processAccessibilityImageGenerationJob,
  buildAccessibilityRenditionS3Key,
  applyAccessibilityVisualMockFallback,
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
  it.each(Object.values(MODIFICATION_CODES))("matches the placement prompt snapshot for %s", (code) => {
    expect(buildAccessibilityVisualEditPrompt([code])).toMatchSnapshot();
  });

  it("numbers each requested modification with its own placement rules", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["GRAB_BARS", "WALK_IN_SHOWER"]);
    expect(prompt).toContain("1. Grab Bars");
    expect(prompt).toContain("2. Walk-In Shower");
    expect(prompt).toContain("33–36 inches");
    expect(prompt).toContain("Never place bars on vanities");
  });

  it("restricts the edit to the listed items", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["HANDRAILS"]);
    expect(prompt).toContain("Add ONLY the items listed above");
    expect(prompt).toContain("Keep every other surface");
  });

  it("does not repeat a duplicated code", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["GRAB_BARS", "GRAB_BARS"]);
    expect(prompt.match(/Grab Bars/g)).toHaveLength(1);
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

describe("buildAccessibilityVisualEditPrompt with a placement plan", () => {
  const plan: PlacementPlan = {
    visibleElements: ["toilet", "vanity", "bathtub"],
    placements: [
      {
        modificationCode: "GRAB_BARS",
        applicable: true,
        placement: "One horizontal bar on the wall to the right of the toilet",
        box: { x: 0.6, y: 0.4, width: 0.2, height: 0.08 },
        reason: null,
      },
      {
        modificationCode: "STAIR_LIFT",
        applicable: false,
        placement: null,
        box: null,
        reason: "No stairs visible",
      },
    ],
  };

  it("matches the plan-aware prompt snapshot", () => {
    expect(buildAccessibilityVisualEditPrompt(["GRAB_BARS", "STAIR_LIFT"], plan)).toMatchSnapshot();
  });

  it("adds the photo-specific placement and area, and moves not-applicable items to a do-not-add list", () => {
    const prompt = buildAccessibilityVisualEditPrompt(["GRAB_BARS", "STAIR_LIFT"], plan);
    expect(prompt).toContain("Visible in this photo: toilet, vanity, bathtub.");
    expect(prompt).toContain("   - In this photo: One horizontal bar on the wall to the right of the toilet");
    expect(prompt).toContain("   - Approximate area: 60%–80% across from the left edge, 40%–48% down from the top edge.");
    expect(prompt).toContain("Do NOT add these (no realistic location in this photo):\n- Stair Lift — No stairs visible");
    expect(prompt).not.toContain("2. Stair Lift");
  });

  it("ignores a plan that marks every modification not applicable", () => {
    const allSkipped: PlacementPlan = { visibleElements: ["sofa"], placements: [plan.placements[1]] };
    expect(buildAccessibilityVisualEditPrompt(["STAIR_LIFT"], allSkipped)).toBe(
      buildAccessibilityVisualEditPrompt(["STAIR_LIFT"])
    );
  });
});

describe("buildPlacementPlanAuditMetadata", () => {
  it("returns null when planning never ran", () => {
    expect(buildPlacementPlanAuditMetadata(null)).toBeNull();
  });

  it("marks a READY plan with nothing applicable as not applied", () => {
    const metadata = buildPlacementPlanAuditMetadata({
      status: "READY",
      plan: {
        visibleElements: [],
        placements: [{ modificationCode: "RAMP", applicable: false, placement: null, box: null, reason: "x" }],
      },
      rawResponse: "{}",
      model: "gpt-4o-mini",
      promptVersion: 1,
      usage: null,
      costUsd: 0,
    });
    expect(metadata).toEqual(expect.objectContaining({ status: "READY", applied: false }));
  });
});

describe("detectSourceImageType", () => {
  it("detects JPEG", () => {
    expect(detectSourceImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mimeType: "image/jpeg",
      extension: "jpg",
    });
  });

  it("detects WebP", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
    expect(detectSourceImageType(webp)).toEqual({ mimeType: "image/webp", extension: "webp" });
  });

  it("detects PNG and falls back to PNG for unknown bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectSourceImageType(png).mimeType).toBe("image/png");
    expect(detectSourceImageType(Buffer.from("unknown")).mimeType).toBe("image/png");
  });
});

describe("buildAccessibilityRenditionS3Key", () => {
  it("namespaces the key by project and photo id", () => {
    const key = buildAccessibilityRenditionS3Key("project-1", "photo-1");
    expect(key).toMatch(/^accessibility-renditions\/project-1\/photo-1-/);
    expect(key.endsWith(".png")).toBe(true);
  });
});

const plannerResponse = JSON.stringify({
  visibleElements: ["toilet"],
  placements: [
    {
      modificationCode: "GRAB_BARS",
      applicable: true,
      placement: "One horizontal bar on the wall to the right of the toilet",
      box: { x: 0.6, y: 0.4, width: 0.2, height: 0.08 },
    },
  ],
});

describe("generateAccessibilityVisual", () => {
  const originalFetch = global.fetch;
  let mockEdit: jest.Mock;
  let mockChatCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEdit = jest.fn();
    mockChatCreate = jest.fn().mockRejectedValue(new Error("planner unavailable"));
    mockedGetOpenAIClient.mockReturnValue({
      images: { edit: mockEdit },
      chat: { completions: { create: mockChatCreate } },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("source-image-bytes").buffer,
    }) as unknown as typeof fetch;

    mockedUploadStreamToS3.mockResolvedValue("https://test-account.r2.cloudflarestorage.com/test-bucket/accessibility-renditions/project-1/photo-1.png");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.IMAGE_EDIT_MASK_ENABLED;
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
      expect.objectContaining({ model: DEFAULT_IMAGE_GENERATION_MODEL, prompt: expect.stringContaining("Grab Bars") })
    );
    expect(mockedUploadStreamToS3).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^accessibility-renditions\/project-1\/photo-1-/),
      "image/png",
      expect.any(Number)
    );
    // gpt-image-2.6-sunburst: (500/1e6)*5 + (200/1e6)*8 + (1000/1e6)*30 = 0.0341
    expect(result.costUsd).toBeCloseTo(0.0341, 6);
    expect(result.model).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.promptVersion).toBe(ACCESSIBILITY_VISUAL_PROMPT_VERSION);
    expect(result.s3Url).toContain("accessibility-renditions");
  });

  it("uses IMAGE_GENERATION_MODEL and reports null cost for an unpriced model", async () => {
    process.env.IMAGE_GENERATION_MODEL = "some-future-image-model";
    mockEdit.mockResolvedValue({
      data: [{ b64_json: Buffer.from("x").toString("base64") }],
      usage: { output_tokens: 1000 },
    });

    try {
      const result = await generateAccessibilityVisual(
        { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
        ["GRAB_BARS"]
      );

      expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({ model: "some-future-image-model" }));
      expect(result.model).toBe("some-future-image-model");
      expect(result.costUsd).toBeNull();
    } finally {
      delete process.env.IMAGE_GENERATION_MODEL;
    }
  });

  it("passes IMAGE_GENERATION_QUALITY to images.edit (medium when unset)", async () => {
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    const photo = { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" };

    const defaulted = await generateAccessibilityVisual(photo, ["GRAB_BARS"]);
    expect(mockEdit.mock.calls[0][0].quality).toBe("medium");
    expect(defaulted.quality).toBe("medium");

    process.env.IMAGE_GENERATION_QUALITY = "high";
    try {
      const high = await generateAccessibilityVisual(photo, ["GRAB_BARS"]);
      expect(mockEdit.mock.calls[1][0].quality).toBe("high");
      expect(high.quality).toBe("high");
    } finally {
      delete process.env.IMAGE_GENERATION_QUALITY;
    }
  });

  it("requests an auto-sized edit and sends JPEG sources with the JPEG type", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]).buffer,
    }) as unknown as typeof fetch;
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.jpg" },
      ["GRAB_BARS"]
    );

    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        size: "auto",
        image: expect.objectContaining({ name: "photo-1.jpg", options: { type: "image/jpeg" } }),
      })
    );
  });

  it("feeds the placement plan into the edit prompt and returns it", async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: plannerResponse } }] });
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    const onPlacementPlan = jest.fn();

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
      ["GRAB_BARS"],
      { onPlacementPlan }
    );

    expect(mockChatCreate.mock.invocationCallOrder[0]).toBeLessThan(mockEdit.mock.invocationCallOrder[0]);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("In this photo: One horizontal bar on the wall to the right of the toilet"),
      })
    );
    expect(result.placementPlan.status).toBe("READY");
    expect(onPlacementPlan).toHaveBeenCalledWith(result.placementPlan);
  });

  it("adds the planner's cost to the edit's cost and reports both shares", async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: plannerResponse } }],
      usage: { prompt_tokens: 10_000, completion_tokens: 1_000 },
    });
    mockEdit.mockResolvedValue({
      data: [{ b64_json: Buffer.from("x").toString("base64") }],
      usage: { output_tokens: 1000, input_tokens_details: { text_tokens: 500, image_tokens: 200 } },
    });

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
      ["GRAB_BARS"]
    );

    // planning (gpt-4o-mini) 0.0021 + editing (gpt-image-2.6-sunburst) 0.0341
    expect(result.costBreakdownUsd).toEqual({ planning: 0.0021, editing: 0.0341 });
    expect(result.costUsd).toBeCloseTo(0.0362, 6);
  });

  it("reports total cost as unknown when the planner model is unpriced", async () => {
    process.env.IMAGE_PLACEMENT_AI_MODEL = "mystery-vision-model";
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: plannerResponse } }],
      usage: { prompt_tokens: 10_000, completion_tokens: 1_000 },
    });
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }], usage: { output_tokens: 1000 } });

    try {
      const result = await generateAccessibilityVisual(
        { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
        ["GRAB_BARS"]
      );

      expect(result.costBreakdownUsd).toEqual({ planning: null, editing: 0.03 });
      expect(result.costUsd).toBeNull();
    } finally {
      delete process.env.IMAGE_PLACEMENT_AI_MODEL;
    }
  });

  it("sends a mask built from the plan's boxes when IMAGE_EDIT_MASK_ENABLED=true and the photo is readable", async () => {
    process.env.IMAGE_EDIT_MASK_ENABLED = "true";
    const realPhoto = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => realPhoto.buffer.slice(realPhoto.byteOffset, realPhoto.byteOffset + realPhoto.length),
    }) as unknown as typeof fetch;
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: plannerResponse } }] });
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.jpg" },
      ["GRAB_BARS"]
    );

    const [request] = mockEdit.mock.calls[0];
    expect(request.mask).toEqual(expect.objectContaining({ name: "photo-1-mask.png", options: { type: "image/png" } }));
    const maskMeta = await sharp(request.mask.buffer).metadata();
    expect([maskMeta.width, maskMeta.height]).toEqual([400, 300]);
    expect(result.placementMask.applied).toBe(true);
  });

  it.each([
    ["unset", undefined],
    ["false", "false"],
  ])("builds no mask when IMAGE_EDIT_MASK_ENABLED is %s, even with a usable plan", async (_label, value) => {
    if (value === undefined) {
      delete process.env.IMAGE_EDIT_MASK_ENABLED;
    } else {
      process.env.IMAGE_EDIT_MASK_ENABLED = value;
    }
    mockChatCreate.mockResolvedValue({ choices: [{ message: { content: plannerResponse } }] });
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
      ["GRAB_BARS"]
    );

    expect(mockEdit.mock.calls[0][0]).not.toHaveProperty("mask");
    expect(result.placementMask).toEqual({ applied: false, reason: "DISABLED" });
  });

  it("falls back to the static placement rules when planning fails", async () => {
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    const result = await generateAccessibilityVisual(
      { id: "photo-1", projectId: "project-1", url: "https://example.com/original.png" },
      ["GRAB_BARS"]
    );

    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: buildAccessibilityVisualEditPrompt(["GRAB_BARS"]) })
    );
    expect(result.placementPlan).toEqual(
      expect.objectContaining({ status: "FAILED", error: "planner unavailable" })
    );
    expect(mockEdit.mock.calls[0][0]).not.toHaveProperty("mask");
    expect(result.placementMask).toEqual({ applied: false, reason: "DISABLED" });
  });

  it("signs the source URL when it points at S3", async () => {
    mockedGetSignedDownloadUrlFromS3Url.mockResolvedValue("https://signed.example.com/original.png");
    mockEdit.mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });

    await generateAccessibilityVisual({
      id: "photo-1",
      projectId: "project-1",
      url: "https://test-account.r2.cloudflarestorage.com/test-bucket/original.png",
    });

    expect(mockedGetSignedDownloadUrlFromS3Url).toHaveBeenCalledWith(
      "https://test-account.r2.cloudflarestorage.com/test-bucket/original.png",
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
  // draftData intentionally declares a DIFFERENT modification than the photo's own
  // declaredModificationCodes, so tests can assert generation reads the per-photo
  // tag (the client's ground truth) and not the project-level list.
  const basePhoto = {
    id: "photo-1",
    projectId: "project-1",
    url: "https://example.com/original.png",
    declaredModificationCodes: ["GRAB_BARS"],
    project: { draftData: { modificationItems: ["Handrails"] }, isManualMode: false },
  };

  let mockEdit: jest.Mock;
  let mockChatCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.photo.findUnique.mockResolvedValue(basePhoto);
    mockedPrisma.photo.update.mockResolvedValue({});

    mockEdit = jest.fn().mockResolvedValue({ data: [{ b64_json: Buffer.from("x").toString("base64") }] });
    mockChatCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: plannerResponse } }],
      usage: { prompt_tokens: 900, completion_tokens: 120 },
    });
    mockedGetOpenAIClient.mockReturnValue({
      images: { edit: mockEdit },
      chat: { completions: { create: mockChatCreate } },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("source-image-bytes").buffer,
    }) as unknown as typeof fetch;

    mockedUploadStreamToS3.mockResolvedValue("https://test-account.r2.cloudflarestorage.com/test-bucket/accessibility-renditions/project-1/photo-1.png");
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
      expect.objectContaining({
        category: "AI_GENERATION",
        outcome: "SUCCESS",
        resourceId: "photo-1",
        metadata: expect.objectContaining({
          outputSource: "LIVE",
          isFallback: false,
          promptVersion: ACCESSIBILITY_VISUAL_PROMPT_VERSION,
          quality: "medium",
        }),
      })
    );
  });

  it("records the full placement plan in the SUCCESS audit metadata", async () => {
    await processAccessibilityImageGenerationJob({ photoId: "photo-1" });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "SUCCESS",
        metadata: expect.objectContaining({
          placementPlan: expect.objectContaining({
            status: "READY",
            applied: true,
            rawResponse: plannerResponse,
            usage: { promptTokens: 900, completionTokens: 120 },
            costUsd: 0.0002,
            plan: expect.objectContaining({ visibleElements: ["toilet"] }),
          }),
          costBreakdownUsd: { planning: 0.0002, editing: 0 },
          // IMAGE_EDIT_MASK_ENABLED is off by default.
          placementMask: { applied: false, reason: "DISABLED" },
        }),
      })
    );
  });

  it("records a failed plan in the audit metadata when planning falls back", async () => {
    mockChatCreate.mockRejectedValue(new Error("planner unavailable"));

    await processAccessibilityImageGenerationJob({ photoId: "photo-1" });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "SUCCESS",
        metadata: expect.objectContaining({
          placementPlan: expect.objectContaining({ status: "FAILED", applied: false, error: "planner unavailable" }),
        }),
      })
    );
  });

  it("still audits the placement plan when the edit fails after planning", async () => {
    mockEdit.mockRejectedValue(new Error("OpenAI rate limited"));

    await expect(processAccessibilityImageGenerationJob({ photoId: "photo-1" })).rejects.toThrow(
      "OpenAI rate limited"
    );

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "FAILURE",
        metadata: expect.objectContaining({
          placementPlan: expect.objectContaining({ status: "READY", applied: true, rawResponse: plannerResponse }),
        }),
      })
    );
  });

  it("generates from the photo's own declaredModificationCodes, not the project-level draftData list", async () => {
    await processAccessibilityImageGenerationJob({ photoId: "photo-1" });

    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("Grab Bars") })
    );
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.not.stringContaining("Handrail") })
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
      expect.objectContaining({
        category: "AI_GENERATION",
        outcome: "FAILURE",
        resourceId: "photo-1",
        metadata: expect.objectContaining({ outputSource: "NONE", isFallback: false, quality: "medium" }),
      })
    );
  });
});

describe("applyAccessibilityVisualMockFallback", () => {
  const basePhoto = {
    id: "photo-1",
    projectId: "project-1",
    url: "https://example.com/original.png",
    declaredModificationCodes: ["GRAB_BARS"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.photo.findUnique.mockResolvedValue(basePhoto);
    mockedPrisma.photo.update.mockResolvedValue({});
  });

  it("persists a mock placeholder and logs a FAILURE fallback audit event", async () => {
    await applyAccessibilityVisualMockFallback("photo-1", "OpenAI rate limited");

    expect(mockedPrisma.photo.update).toHaveBeenCalledWith({
      where: { id: "photo-1" },
      data: expect.objectContaining({
        generatedImageS3Key: null,
        generationModel: "mock-fallback",
        generatedImageUrl: expect.stringContaining("placehold.co"),
      }),
    });

    expect(mockedLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "AI_GENERATION",
        action: "ACCESSIBILITY_IMAGE_GENERATION_FALLBACK",
        outcome: "FAILURE",
        resourceId: "photo-1",
        reason: "OpenAI rate limited",
        metadata: expect.objectContaining({ outputSource: "MOCK", isFallback: true }),
      })
    );
  });

  it("does nothing when the photo no longer exists", async () => {
    mockedPrisma.photo.findUnique.mockResolvedValue(null);

    await applyAccessibilityVisualMockFallback("missing", "some error");

    expect(mockedPrisma.photo.update).not.toHaveBeenCalled();
    expect(mockedLogAuditEventNonBlocking).not.toHaveBeenCalled();
  });
});
