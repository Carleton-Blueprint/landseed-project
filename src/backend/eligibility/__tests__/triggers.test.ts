/**
 * @jest-environment node
 *
 * Uses the node test environment because triggers.ts relies on the Node
 * `setImmediate` global, which jsdom (this repo's default test environment)
 * does not provide. See grantPdfTrigger.test.ts for precedent.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    eligibilityAssessment: {
      findFirst: jest.fn(),
    },
    quote: {
      findFirst: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../service", () => ({
  evaluateProjectEligibility: jest.fn(),
}));

type ProjectRow = {
  id: string;
  isManualMode: boolean;
  [key: string]: unknown;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    eligibilityAssessment: {
      findFirst: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    };
    quote: { findFirst: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
    project: { findUnique: jest.Mock<(...args: unknown[]) => Promise<ProjectRow | null>> };
  };
};
const { evaluateProjectEligibility } = require("../service") as {
  evaluateProjectEligibility: jest.Mock<(...args: unknown[]) => Promise<undefined>>;
};

const { queueEligibilityEvaluation } = require("../triggers") as typeof import("../triggers");

const HOUR_MS = 60 * 60 * 1000;

type AssessmentRow = { createdAt: Date; source: "AUTOMATIC" | "ADMIN" };

/**
 * Backs eligibilityAssessment.findFirst with an in-memory list, honouring the
 * two query shapes shouldEvaluateNow uses: the any-ADMIN lookup and the
 * isLatest lookup (last element is latest).
 */
function mockAssessments(rows: AssessmentRow[]) {
  prisma.eligibilityAssessment.findFirst.mockImplementation(async (args: unknown) => {
    const where = (args as { where: { source?: string } }).where;
    if (where.source) {
      const match = rows.find((row) => row.source === where.source);
      return match ? { id: "assessment-admin" } : null;
    }
    return rows.length > 0 ? rows[rows.length - 1] : null;
  });
}

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildProject(overrides?: Record<string, unknown>): ProjectRow {
  return {
    id: "project-1",
    isManualMode: false,
    ...overrides,
  };
}

describe("triggers", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Default: no prior assessment and no quote -> should evaluate
    mockAssessments([]);
    prisma.quote.findFirst.mockResolvedValue(null);
    evaluateProjectEligibility.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe("queueEligibilityEvaluation", () => {
    it("warns and returns without evaluating when the project is not found", async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await queueEligibilityEvaluation("missing-project");
      await flushImmediate();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing-project"),
      );
      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("returns without evaluating when the project is in manual mode", async () => {
      const project = buildProject({ isManualMode: true });
      prisma.project.findUnique.mockResolvedValue(project);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("evaluates when the project exists, is not manual, and is not rate-limited", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("debounces when the latest assessment is AUTOMATIC and under 30s old", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      mockAssessments([{ source: "AUTOMATIC", createdAt: new Date(Date.now() - 1_000) }]);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("evaluates when the latest assessment is AUTOMATIC and over 30s old", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      mockAssessments([{ source: "AUTOMATIC", createdAt: new Date(Date.now() - 60_000) }]);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("skips when a recent ADMIN assessment exists", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      mockAssessments([{ source: "ADMIN", createdAt: new Date(Date.now() - HOUR_MS) }]);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("an admin assessment exists"));
    });

    it("still skips when the ADMIN assessment is days old", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      mockAssessments([{ source: "ADMIN", createdAt: new Date(Date.now() - 72 * HOUR_MS) }]);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("skips whenever the latest quote has a QuoteOverride, regardless of age", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.quote.findFirst.mockResolvedValue({ override: { id: "override-1" } });

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("post-estimate override"));
    });

    it("evaluates when the latest quote has no QuoteOverride", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.quote.findFirst.mockResolvedValue({ override: null });

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    describe("pre-estimate override re-run", () => {
      it("skips the admin-precedence check and debounce, and saves as ADMIN / PRE_ESTIMATE_OVERRIDE", async () => {
        const project = buildProject();
        prisma.project.findUnique.mockResolvedValue(project);
        mockAssessments([
          { source: "ADMIN", createdAt: new Date(Date.now() - HOUR_MS) },
          { source: "AUTOMATIC", createdAt: new Date(Date.now() - 1_000) },
        ]);

        await queueEligibilityEvaluation(project.id, { preEstimateOverrideBy: "admin-1" });
        await flushImmediate();

        expect(evaluateProjectEligibility).toHaveBeenCalledWith(
          project,
          { id: "admin-1" },
          { adminAction: "PRE_ESTIMATE_OVERRIDE" }
        );
      });

      it("still skips when the latest quote has a QuoteOverride", async () => {
        const project = buildProject();
        prisma.project.findUnique.mockResolvedValue(project);
        prisma.quote.findFirst.mockResolvedValue({ override: { id: "override-1" } });

        await queueEligibilityEvaluation(project.id, { preEstimateOverrideBy: "admin-1" });
        await flushImmediate();

        expect(evaluateProjectEligibility).not.toHaveBeenCalled();
      });
    });

    it("logs a warning and swallows errors thrown during evaluation", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      evaluateProjectEligibility.mockRejectedValue(new Error("boom"));

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });
});
