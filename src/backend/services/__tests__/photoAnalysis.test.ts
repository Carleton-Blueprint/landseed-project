import { MODIFICATION_CODES } from "@/backend/eligibility/types";
import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import {
  analyzeProjectPhoto,
  buildPhotoAnalysisPrompt,
  PHOTO_ANALYSIS_PROMPT_VERSION,
  processPhotoModificationAnalysisJob,
} from "../photoAnalysis";
import { Prisma } from "@prisma/client";

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

  it("asks for no per-code verdicts when nothing was declared", () => {
    expect(buildPhotoAnalysisPrompt()).not.toContain("declaredCodeVerdicts");
  });

  it("asks for a YES / NO / CANT_TELL verdict on each declared code", () => {
    const prompt = buildPhotoAnalysisPrompt(["GRAB_BARS", "RAMP"]);
    expect(prompt).toContain("requested these modifications for the space in this photo: GRAB_BARS, RAMP");
    expect(prompt).toContain('"declaredCodeVerdicts"');
    expect(prompt).toContain("CANT_TELL");
  });
});

describe("analyzeProjectPhoto", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
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

  describe("declared code verdicts", () => {
    function mockContent(body: Record<string, unknown>) {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ modificationCodes: [], confidence: "HIGH", rationale: "r", ...body }) } }],
      });
    }

    function sentPrompt(): string {
      return mockCreate.mock.calls[0][0].messages[0].content[0].text;
    }

    it("returns no verdicts and sends the plain prompt when no codes are declared", async () => {
      mockContent({});

      const result = await analyzeProjectPhoto("https://example.com/photo.png");

      expect(result.declaredCodeVerdicts).toEqual([]);
      expect(sentPrompt()).not.toContain("declaredCodeVerdicts");
    });

    it("parses one verdict per declared code, in declared order", async () => {
      mockContent({
        declaredCodeVerdicts: [
          { code: "HANDRAILS", verdict: "CANT_TELL", confidence: "MEDIUM" },
          { code: "GRAB_BARS", verdict: "NO", confidence: "HIGH" },
        ],
      });

      const result = await analyzeProjectPhoto("https://example.com/photo.png", ["GRAB_BARS", "HANDRAILS"]);

      expect(sentPrompt()).toContain("GRAB_BARS, HANDRAILS");
      expect(result.declaredCodeVerdicts).toEqual([
        { code: "GRAB_BARS", verdict: "NO", confidence: "HIGH" },
        { code: "HANDRAILS", verdict: "CANT_TELL", confidence: "MEDIUM" },
      ]);
    });

    it("falls back to LOW-confidence CANT_TELL for missing or unrecognized verdicts", async () => {
      mockContent({
        declaredCodeVerdicts: [
          { code: "GRAB_BARS", verdict: "MAYBE", confidence: "HIGH" },
          { code: "RAMP", verdict: "YES", confidence: "VERY_HIGH" },
        ],
      });

      const result = await analyzeProjectPhoto("https://example.com/photo.png", ["GRAB_BARS", "RAMP", "HANDRAILS"]);

      expect(result.declaredCodeVerdicts).toEqual([
        { code: "GRAB_BARS", verdict: "CANT_TELL", confidence: "LOW" },
        { code: "RAMP", verdict: "YES", confidence: "LOW" },
        { code: "HANDRAILS", verdict: "CANT_TELL", confidence: "LOW" },
      ]);
    });

    it("treats a non-array declaredCodeVerdicts as CANT_TELL for every declared code", async () => {
      mockContent({ declaredCodeVerdicts: "none" });

      const result = await analyzeProjectPhoto("https://example.com/photo.png", ["GRAB_BARS"]);

      expect(result.declaredCodeVerdicts).toEqual([{ code: "GRAB_BARS", verdict: "CANT_TELL", confidence: "LOW" }]);
    });

    it("ignores verdicts for codes that weren't declared and drops unknown declared codes", async () => {
      mockContent({
        declaredCodeVerdicts: [
          { code: "GRAB_BARS", verdict: "YES", confidence: "HIGH" },
          { code: "STAIR_LIFT", verdict: "NO", confidence: "HIGH" },
        ],
      });

      const result = await analyzeProjectPhoto("https://example.com/photo.png", ["GRAB_BARS", "NOT_A_REAL_CODE"]);

      expect(sentPrompt()).not.toContain("NOT_A_REAL_CODE");
      expect(result.declaredCodeVerdicts).toEqual([{ code: "GRAB_BARS", verdict: "YES", confidence: "HIGH" }]);
    });
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

  describe("reasoning effort", () => {
    const emptyResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({ modificationCodes: [], confidence: "LOW", rationale: "" }),
          },
        },
      ],
    };

    it("sends no reasoning_effort when PHOTO_ANALYSIS_AI_REASONING_EFFORT is unset", async () => {
      delete process.env.PHOTO_ANALYSIS_AI_REASONING_EFFORT;
      mockCreate.mockResolvedValue(emptyResponse);

      await analyzeProjectPhoto("https://example.com/photo.png");

      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
    });

    it("sends reasoning_effort from PHOTO_ANALYSIS_AI_REASONING_EFFORT", async () => {
      process.env.PHOTO_ANALYSIS_AI_REASONING_EFFORT = " Low ";
      mockCreate.mockResolvedValue(emptyResponse);

      await analyzeProjectPhoto("https://example.com/photo.png");

      expect(mockCreate.mock.calls[0][0]).toMatchObject({
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      });
    });

    it("ignores an invalid PHOTO_ANALYSIS_AI_REASONING_EFFORT", async () => {
      process.env.PHOTO_ANALYSIS_AI_REASONING_EFFORT = "turbo";
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      mockCreate.mockResolvedValue(emptyResponse);

      try {
        await analyzeProjectPhoto("https://example.com/photo.png");

        expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("PHOTO_ANALYSIS_AI_REASONING_EFFORT"));
      } finally {
        warn.mockRestore();
      }
    });
  });
});

describe("processPhotoModificationAnalysisJob", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
    mockFindMany.mockResolvedValue([]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function mockPhoto(analysisStatus = "PENDING", declaredModificationCodes: string[] = []) {
    mockFindUnique.mockResolvedValue({
      id: "photo-1",
      projectId: "project-1",
      url: "https://example.com/photo.png",
      analysisStatus,
      declaredModificationCodes,
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
    aiCodeVerdicts?: unknown;
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
        aiCodeVerdicts: p.aiCodeVerdicts ?? null,
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

  it("sends the photo's declared codes and stores the verdicts with the prompt version", async () => {
    mockPhoto("PENDING", ["GRAB_BARS"]);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              modificationCodes: ["GRAB_BARS"],
              confidence: "HIGH",
              declaredCodeVerdicts: [{ code: "GRAB_BARS", verdict: "YES", confidence: "HIGH" }],
              rationale: "test",
            }),
          },
        },
      ],
    });
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    const verdicts = [{ code: "GRAB_BARS", verdict: "YES", confidence: "HIGH" }];
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: "photo-1" },
      data: expect.objectContaining({ aiCodeVerdicts: verdicts }),
    });
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ declaredCodeVerdicts: verdicts, promptVersion: PHOTO_ANALYSIS_PROMPT_VERSION }),
      })
    );
  });

  it("stores null verdicts (not []) when the analysis produced no signal", async () => {
    mockPhoto("PENDING", ["GRAB_BARS"]);
    mockCreate.mockRejectedValue(new Error("network down"));
    mockProjectPhotos([{ id: "photo-1", analysisStatus: "FAILED" }]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: "photo-1" },
      data: expect.objectContaining({ analysisStatus: "FAILED", aiCodeVerdicts: Prisma.DbNull }),
    });
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
            {
              photoId: "photo-1",
              declaredCodes: ["WIDENED_DOORWAY"],
              aiInferredCodes: ["GRAB_BARS"],
              aiCodeVerdicts: null,
              missingCodes: ["WIDENED_DOORWAY"],
            },
          ],
          suggestedCodes: [{ photoId: "photo-1", suggestedCodes: ["GRAB_BARS"] }],
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
            {
              photoId: "photo-2",
              declaredCodes: ["WIDENED_DOORWAY"],
              aiInferredCodes: ["STAIR_LIFT"],
              aiCodeVerdicts: null,
              missingCodes: ["WIDENED_DOORWAY"],
            },
          ],
          suggestedCodes: [{ photoId: "photo-2", suggestedCodes: ["STAIR_LIFT"] }],
        },
      }),
      expect.anything()
    );
  });

  it("does not flag when the AI only adds codes beyond the declared ones", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS", "NON_SLIP_FLOORING"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS", "NON_SLIP_FLOORING"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it.each([
    [["RAMP"], ["WHEELCHAIR_RAMP"]],
    [["WHEELCHAIR_RAMP"], ["RAMP"]],
  ])("treats RAMP and WHEELCHAIR_RAMP as one code (declared %j, AI %j)", async (declared, ai) => {
    mockPhoto();
    mockOpenAiResponse(ai, "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: declared, aiModificationCodes: ai, aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
  });

  it("does not treat WALK_IN_TUB and WALK_IN_SHOWER as the same code", async () => {
    mockPhoto();
    mockOpenAiResponse(["WALK_IN_SHOWER"], "HIGH");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["WALK_IN_TUB"], aiModificationCodes: ["WALK_IN_SHOWER"], aiConfidence: "HIGH" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        metadata: expect.objectContaining({
          mismatchedPhotos: [expect.objectContaining({ missingCodes: ["WALK_IN_TUB"] })],
        }),
      }),
      expect.anything()
    );
  });

  it("records extra AI codes as suggestions when the project is flagged for LOW confidence", async () => {
    mockPhoto();
    mockOpenAiResponse(["GRAB_BARS", "RAISED_TOILET"], "LOW");
    mockProjectPhotos([
      { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: ["GRAB_BARS"], aiModificationCodes: ["GRAB_BARS", "RAISED_TOILET"], aiConfidence: "LOW" },
    ]);

    await processPhotoModificationAnalysisJob({ photoId: "photo-1" });

    expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
      "manual-review",
      expect.objectContaining({
        metadata: {
          analyzedPhotoCount: 1,
          mismatchedPhotos: [],
          suggestedCodes: [{ photoId: "photo-1", suggestedCodes: ["RAISED_TOILET"] }],
        },
      }),
      expect.anything()
    );
  });

  describe("with stored verdicts", () => {
    async function reconcileWith(verdicts: unknown, declared = ["GRAB_BARS"], ai: string[] = []) {
      mockPhoto();
      mockOpenAiResponse(ai, "HIGH");
      mockProjectPhotos([
        { id: "photo-1", analysisStatus: "READY", declaredModificationCodes: declared, aiModificationCodes: ai, aiConfidence: "HIGH", aiCodeVerdicts: verdicts },
      ]);
      await processPhotoModificationAnalysisJob({ photoId: "photo-1" });
    }

    it("flags on a HIGH-confidence NO, even when the AI listed the code", async () => {
      const verdicts = [{ code: "GRAB_BARS", verdict: "NO", confidence: "HIGH" }];
      await reconcileWith(verdicts, ["GRAB_BARS"], ["GRAB_BARS"]);

      expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
        "manual-review",
        expect.objectContaining({
          metadata: expect.objectContaining({
            mismatchedPhotos: [expect.objectContaining({ missingCodes: ["GRAB_BARS"], aiCodeVerdicts: verdicts })],
          }),
        }),
        expect.anything()
      );
    });

    it.each([
      ["CANT_TELL", "HIGH"],
      ["NO", "MEDIUM"],
      ["NO", "LOW"],
      ["YES", "HIGH"],
    ])("does not flag on %s / %s, even when the AI didn't list the code", async (verdict, confidence) => {
      await reconcileWith([{ code: "GRAB_BARS", verdict, confidence }]);

      expect(mockManualReviewQueueAdd).not.toHaveBeenCalled();
    });

    it("falls back to the missing-code rule for a declared code with no verdict", async () => {
      // HANDRAILS was added (e.g. by an admin override) after the photo was analysed.
      await reconcileWith([{ code: "GRAB_BARS", verdict: "YES", confidence: "HIGH" }], ["GRAB_BARS", "HANDRAILS"], ["GRAB_BARS"]);

      expect(mockManualReviewQueueAdd).toHaveBeenCalledWith(
        "manual-review",
        expect.objectContaining({
          metadata: expect.objectContaining({
            mismatchedPhotos: [expect.objectContaining({ missingCodes: ["HANDRAILS"] })],
          }),
        }),
        expect.anything()
      );
    });

    it("ignores malformed stored verdicts and falls back to the missing-code rule", async () => {
      await reconcileWith([{ code: "GRAB_BARS" }, "junk"]);

      expect(mockManualReviewQueueAdd).toHaveBeenCalledTimes(1);
    });
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
