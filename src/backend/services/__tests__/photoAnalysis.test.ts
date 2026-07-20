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
const mockFindMany = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    photo: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
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
    process.env.PHOTO_ANALYSIS_AI_ENABLED = "true";
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

  it("defaults to SKIPPED (dark ship) when PHOTO_ANALYSIS_AI_ENABLED is unset", async () => {
    delete process.env.PHOTO_ANALYSIS_AI_ENABLED;

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
    process.env.PHOTO_ANALYSIS_AI_ENABLED = "true";
    delete process.env.PHOTO_ANALYSIS_MOCK_AI;
    mockFindMany.mockResolvedValue([]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function mockPhoto(modificationItems: string[] = ["Grab bars"], analysisStatus = "PENDING") {
    mockFindUnique.mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      url: "https://example.com/photo.png",
      analysisStatus,
      project: { id: "project-1", draftData: { modificationItems } },
    });
  }

  function mockOpenAiResponse(modificationCodes: string[], confidence: string) {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ modificationCodes, confidence, rationale: "test" }) } }],
    });
  }

  interface SiblingPhoto {
    virus_scan_status?: string;
    analysisStatus: string;
    aiModificationCodes?: string[];
    aiConfidence?: string | null;
  }

  // Represents the state of ALL of the project's photos (including this job's own photo,
  // post-update) as seen by the project-level completion/reconciliation check.
  function mockProjectPhotos(photos: SiblingPhoto[]) {
    mockFindMany.mockResolvedValue(
      photos.map((p) => ({
        virus_scan_status: p.virus_scan_status ?? "clean",
        analysisStatus: p.analysisStatus,
        aiModificationCodes: p.aiModificationCodes ?? [],
        aiConfidence: p.aiConfidence ?? null,
      }))
    );
  }

  it("throws when the photo is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(processPhotoModificationAnalysisJob({ photoId: "missing" })).rejects.toThrow(
      "Photo not found: missing"
    );
  });

  it.each(["READY", "ANALYZING"])(
    "skips re-analysis (cost guardrail) when the photo is already %s",
    async (analysisStatus) => {
      mockPhoto(["Grab bars"], analysisStatus);

      await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    }
  );

  it("persists the analysis result and logs an audit event regardless of reconciliation outcome", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([{ analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

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

  it("does not reconcile while another of the project's photos is still pending analysis", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { analysisStatus: "PENDING" }, // sibling photo not yet analyzed
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("is a project-level no-op when the union of all photos' codes agrees with the declared codes", async () => {
    mockPhoto(["Grab bars", "Widened doorway"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    // This photo shows GRAB_BARS; a sibling (e.g. an entryway shot) shows WIDENED_DOORWAY —
    // together they account for everything declared, so no photo alone needs to match.
    mockProjectPhotos([
      { analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { analysisStatus: "READY", aiModificationCodes: ["WIDENED_DOORWAY"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("flags a manual review when the union of all photos' codes still disagrees with the declared codes", async () => {
    mockPhoto(["Grab bars", "Widened doorway"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([{ analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        projectId: "project-1",
        reason: "PHOTO_MODIFICATION_MISMATCH",
        aiConfidence: "HIGH",
        metadata: {
          declaredCodes: ["GRAB_BARS", "WIDENED_DOORWAY"],
          aiInferredCodes: ["GRAB_BARS"],
          analyzedPhotoCount: 1,
        },
      }),
      expect.objectContaining({ jobId: "manual-review-project-1-photo-mismatch" })
    );
  });

  it("flags a manual review when every analyzed photo is LOW confidence, even if codes match", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "LOW");
    mockProjectPhotos([{ analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "LOW" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not flag on mixed confidence when the union of codes still matches", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "LOW");
    // One LOW-confidence photo alongside a HIGH-confidence one that agrees — not ALL low,
    // so a single uncertain photo shouldn't drag down an otherwise solid match.
    mockProjectPhotos([
      { analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "LOW" },
      { analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("treats infected sibling photos as excluded (not pending) for the completion check", async () => {
    mockPhoto(["Grab bars"]);
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { virus_scan_status: "infected", analysisStatus: "PENDING" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    // Complete (infected photo excluded) and codes match — no flag, but this confirms
    // completion wasn't blocked by the infected photo's still-PENDING analysisStatus.
    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("does not reconcile when no photo on the project produced a usable READY result", async () => {
    mockPhoto(["Grab bars"]);
    mockCreate.mockRejectedValue(new Error("network timeout"));
    mockProjectPhotos([{ analysisStatus: "FAILED" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_MODIFICATION_ANALYSIS_FAILED", outcome: "FAILURE" })
    );
  });
});
