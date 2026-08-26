import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import {
  analyzeProjectPhoto,
  buildPhotoAnalysisPrompt,
  processPhotoModificationAnalysisJob,
} from "../photoAnalysis";

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
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ modificationCodes: [], confidence: "LOW", rationale: "" }),
          },
        },
      ],
    });

    await analyzeProjectPhoto("https://test-account.r2.cloudflarestorage.com/test-bucket/photo.png");

    expect(getSignedDownloadUrlFromS3Url).toHaveBeenCalledWith(
      "https://test-account.r2.cloudflarestorage.com/test-bucket/photo.png",
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

  function mockPhoto(analysisStatus = "PENDING") {
    mockFindUnique.mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      url: "https://example.com/photo.png",
      analysisStatus,
      project: { id: "project-1", isManualMode: false },
    });
  }

  function mockOpenAiResponse(modificationCodes: string[], confidence: string) {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ modificationCodes, confidence, rationale: "test" }) } }],
    });
  }

  interface SiblingPhoto {
    id?: string;
    virus_scan_status?: string;
    analysisStatus: string;
    declaredModificationCodes?: string[];
    aiModificationCodes?: string[];
    aiConfidence?: string | null;
  }

  // Represents the state of ALL of the project's photos (including this job's own photo,
  // post-update) as seen by the project-level completion check / per-photo reconciliation.
  function mockProjectPhotos(photos: SiblingPhoto[]) {
    mockFindMany.mockResolvedValue(
      photos.map((p, i) => ({
        id: p.id ?? `photo-${i + 1}`,
        virus_scan_status: p.virus_scan_status ?? "clean",
        analysisStatus: p.analysisStatus,
        declaredModificationCodes: p.declaredModificationCodes ?? [],
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
      mockPhoto(analysisStatus);

      await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    }
  );

  it("persists the analysis result and logs an audit event regardless of reconciliation outcome", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

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
      expect.objectContaining({
        action: "PHOTO_MODIFICATION_ANALYSIS_READY",
        outcome: "SUCCESS",
        metadata: expect.objectContaining({ outputSource: "LIVE", isFallback: false }),
      })
    );
  });

  it("logs outputSource=MOCK (not a fallback) when PHOTO_ANALYSIS_MOCK_AI is enabled", async () => {
    process.env.PHOTO_ANALYSIS_MOCK_AI = "true";
    mockPhoto();
    mockProjectPhotos([{ analysisStatus: "READY", aiModificationCodes: ["GRAB_BARS"], aiConfidence: "MEDIUM" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_MODIFICATION_ANALYSIS_READY",
        outcome: "SUCCESS",
        metadata: expect.objectContaining({ model: "mock", outputSource: "MOCK", isFallback: false }),
      })
    );
  });

  it("logs outputSource=NONE when the live call fails (no mock fallback is applied)", async () => {
    mockPhoto();
    mockCreate.mockRejectedValue(new Error("OpenAI rate limited"));

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_MODIFICATION_ANALYSIS_FAILED",
        outcome: "FAILURE",
        metadata: expect.objectContaining({ outputSource: "NONE", isFallback: false }),
      })
    );
  });

  it("does not reconcile while another of the project's photos is still pending analysis", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { analysisStatus: "PENDING" }, // sibling photo not yet analyzed
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("does not flag when this photo's declared codes match its own AI-inferred codes", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("flags a manual review when this photo's declared codes disagree with its own AI-inferred codes", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["WIDENED_DOORWAY"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        projectId: "project-1",
        reason: "PHOTO_MODIFICATION_MISMATCH",
        aiConfidence: "HIGH",
        metadata: {
          analyzedPhotoCount: 1,
          mismatchedPhotos: [
            { photoId: "photo-1", declaredCodes: ["WIDENED_DOORWAY"], aiInferredCodes: ["GRAB_BARS"] },
          ],
        },
      }),
      expect.objectContaining({ jobId: "manual-review-project-1-photo-mismatch" })
    );
  });

  it("does not flag when each photo's own codes match, even though sibling photos declare different things", async () => {
    // The old project-level union comparison would have needed a bathroom photo to
    // "account for" a declared doorway-widening code (a false-positive risk it existed
    // to avoid). Per-photo comparison sidesteps that entirely: each photo only needs to
    // match its own declared tag.
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { id: "photo-2", analysisStatus: "READY", declaredModificationCodes: ["WIDENED_DOORWAY"], aiModificationCodes: ["WIDENED_DOORWAY"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("flags a manual review for just the mismatched sibling when another photo on the project agrees", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { id: "photo-2", analysisStatus: "READY", declaredModificationCodes: ["WIDENED_DOORWAY"], aiModificationCodes: ["STAIR_LIFT"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        metadata: {
          analyzedPhotoCount: 2,
          mismatchedPhotos: [
            { photoId: "photo-2", declaredCodes: ["WIDENED_DOORWAY"], aiInferredCodes: ["STAIR_LIFT"] },
          ],
        },
      }),
      expect.anything()
    );
  });

  it("flags a manual review when every analyzed photo is LOW confidence, even if codes match", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "LOW");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "LOW" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not flag on mixed confidence when each photo's own codes still match", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "LOW");
    // One LOW-confidence photo alongside a HIGH-confidence one — not ALL low, and each
    // photo's own declared/inferred codes agree, so nothing should flag.
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "LOW" },
      { id: "photo-2", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("treats infected sibling photos as excluded (not pending) for the completion check", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { virus_scan_status: "infected", analysisStatus: "PENDING" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    // Complete (infected photo excluded) and codes match — no flag, but this confirms
    // completion wasn't blocked by the infected photo's still-PENDING analysisStatus.
    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("treats a sibling's failed virus scan as excluded (not pending) for the completion check", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
      { virus_scan_status: "failed", analysisStatus: "PENDING" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    // Complete (scan-failed photo excluded) and codes match — no flag, but this confirms
    // completion wasn't blocked forever by a scan failure that can never resolve to
    // clean/infected and so would otherwise leave analysisStatus stuck at PENDING.
    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("does not reconcile when no photo on the project produced a usable READY result", async () => {
    mockPhoto();
    mockCreate.mockRejectedValue(new Error("network timeout"));
    mockProjectPhotos([{ analysisStatus: "FAILED" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_MODIFICATION_ANALYSIS_FAILED", outcome: "FAILURE" })
    );
  });
});
