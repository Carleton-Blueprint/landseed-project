import { MODIFICATION_CODES } from "@/backend/eligibility/types";

const mockCreate = jest.fn();

jest.mock("lib/openai", () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
}));

jest.mock("lib/s3", () => ({
  getSignedDownloadUrlFromS3Url: jest.fn().mockResolvedValue("https://signed.example.com/photo.png"),
}));

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockLogAuditEventNonBlocking = jest.fn().mockResolvedValue(undefined);
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: (...args: unknown[]) => mockLogAuditEventNonBlocking(...args),
}));

const mockManualReviewQueueAdd = jest.fn().mockResolvedValue(undefined);
jest.mock("@/backend/queue", () => ({
  manualReviewQueue: { add: (...args: unknown[]) => mockManualReviewQueueAdd(...args) },
}));

const {
  analyzeProjectPhoto,
  buildPhotoAnalysisPrompt,
  processPhotoModificationAnalysisJob,
} = require("../photoAnalysis") as typeof import("../photoAnalysis");

describe("buildPhotoAnalysisPrompt", () => {
  it("includes every modification code in the taxonomy", () => {
    const prompt = buildPhotoAnalysisPrompt();
    for (const code of Object.values(MODIFICATION_CODES)) {
      expect(prompt).toContain(code);
    }
  });
});

describe("analyzeProjectPhoto", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.PHOTO_ANALYSIS_AI_ENABLED;
    delete process.env.PHOTO_ANALYSIS_MOCK_AI;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns a SKIPPED no-signal result when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.status).toBe("SKIPPED");
    expect(result.modificationCodes).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns a SKIPPED no-signal result when PHOTO_ANALYSIS_AI_ENABLED=false", async () => {
    process.env.PHOTO_ANALYSIS_AI_ENABLED = "false";

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.status).toBe("SKIPPED");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns hardcoded mock data in mock mode without calling OpenAI", async () => {
    process.env.PHOTO_ANALYSIS_MOCK_AI = "true";

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.status).toBe("READY");
    expect(result.model).toBe("mock");
    expect(result.modificationCodes.length).toBeGreaterThan(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("parses a well-formed OpenAI response into modification codes", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              modificationCodes: ["GRAB_BARS", "WALK_IN_SHOWER"],
              confidence: "HIGH",
              rationale: "Bathroom fixtures visible.",
            }),
          },
        },
      ],
    });

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.status).toBe("READY");
    expect(result.modificationCodes).toEqual(["GRAB_BARS", "WALK_IN_SHOWER"]);
    expect(result.confidence).toBe("HIGH");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("drops modification codes outside the known taxonomy", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              modificationCodes: ["GRAB_BARS", "NOT_A_REAL_CODE"],
              confidence: "MEDIUM",
              rationale: "Partial match.",
            }),
          },
        },
      ],
    });

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.modificationCodes).toEqual(["GRAB_BARS"]);
  });

  it("returns a FAILED no-signal result (not a throw) on malformed JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json at all" } }],
    });

    const result = await analyzeProjectPhoto("https://example.com/photo.png");

    expect(result.status).toBe("FAILED");
    expect(result.modificationCodes).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("returns a FAILED no-signal result (not a throw) when the API call rejects", async () => {
    mockCreate.mockRejectedValue(new Error("network timeout"));

    await expect(analyzeProjectPhoto("https://example.com/photo.png")).resolves.toMatchObject({
      status: "FAILED",
      modificationCodes: [],
      error: "network timeout",
    });
  });

  it("signs S3 photo URLs before calling OpenAI", async () => {
    const { getSignedDownloadUrlFromS3Url } = require("lib/s3");
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ modificationCodes: [], confidence: "LOW", rationale: "" }),
          },
        },
      ],
    });

    await analyzeProjectPhoto("https://my-bucket.s3.amazonaws.com/photo.png");

    expect(getSignedDownloadUrlFromS3Url).toHaveBeenCalledWith(
      "https://my-bucket.s3.amazonaws.com/photo.png",
      300
    );
  });
});

describe("processPhotoModificationAnalysisJob", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.PHOTO_ANALYSIS_AI_ENABLED;
    delete process.env.PHOTO_ANALYSIS_MOCK_AI;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function mockPhoto(modificationItems: string[] = ["Grab bars"]) {
    mockFindUnique.mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      url: "https://example.com/photo.png",
      project: { id: "project-1", draftData: { modificationItems } },
    });
  }

  function mockOpenAiResponse(modificationCodes: string[], confidence: string) {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ modificationCodes, confidence, rationale: "test" }) } }],
    });
  }

  it("throws when the photo is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(processPhotoModificationAnalysisJob({ photoId: "missing" })).rejects.toThrow(
      "Photo not found: missing"
    );
  });

  it("is a no-op when AI-inferred codes agree with the client's declared codes", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: "photo-1" },
      data: expect.objectContaining({
        analysisStatus: "READY",
        aiModificationCodes: ["GRAB_BARS"],
        aiConfidence: "HIGH",
      }),
    });
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_MODIFICATION_ANALYSIS_READY", outcome: "SUCCESS" })
    );
  });

  it("flags a manual review when AI-inferred codes disagree with the client's declared codes", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["WALK_IN_SHOWER"], "HIGH");

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        projectId: "project-1",
        reason: "PHOTO_MODIFICATION_MISMATCH",
        photoId: "photo-1",
        metadata: { declaredCodes: ["GRAB_BARS"], aiInferredCodes: ["WALK_IN_SHOWER"] },
      }),
      expect.objectContaining({ jobId: "manual-review-project-1-photo-photo-1" })
    );
  });

  it("flags a manual review on LOW confidence even when the codes agree", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "LOW");

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not reconcile or flag when analysis produces no signal", async () => {
    mockPhoto(["Grab bars"]);
    mockCreate.mockRejectedValue(new Error("network timeout"));

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_MODIFICATION_ANALYSIS_FAILED", outcome: "FAILURE" })
    );
  });
});
