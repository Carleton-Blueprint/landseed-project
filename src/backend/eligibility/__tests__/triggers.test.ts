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
      findFirst: jest.Mock<(...args: unknown[]) => Promise<{ createdAt: Date } | null>>;
    };
    project: { findUnique: jest.Mock<(...args: unknown[]) => Promise<ProjectRow | null>> };
  };
};
const { evaluateProjectEligibility } = require("../service") as {
  evaluateProjectEligibility: jest.Mock<(...args: unknown[]) => Promise<undefined>>;
};

const { queueEligibilityEvaluation } = require("../triggers") as typeof import("../triggers");

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
    // Default: no prior assessment -> should evaluate
    prisma.eligibilityAssessment.findFirst.mockResolvedValue(null);
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
      prisma.eligibilityAssessment.findFirst.mockResolvedValue(null);

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("rate-limits and does not evaluate within the cooldown window", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);
      prisma.eligibilityAssessment.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 1_000),
      });

      await queueEligibilityEvaluation(project.id);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
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
