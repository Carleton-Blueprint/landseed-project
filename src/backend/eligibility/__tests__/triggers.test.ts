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

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: {
    eligibilityAssessment: { findFirst: jest.Mock };
    project: { findUnique: jest.Mock };
  };
};
const { evaluateProjectEligibility } = require("../service") as {
  evaluateProjectEligibility: jest.Mock;
};

const {
  triggerEvaluationAfterProjectCreation,
  triggerEvaluationAfterDraftUpdate,
  queueEligibilityEvaluation,
} = require("../triggers") as typeof import("../triggers");

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildProject(overrides?: Record<string, unknown>) {
  return {
    id: "project-1",
    isManualMode: false,
    ...overrides,
  } as any;
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

  describe("triggerEvaluationAfterProjectCreation", () => {
    it("short-circuits synchronously when project.isManualMode is true", async () => {
      const project = buildProject({ isManualMode: true });

      await triggerEvaluationAfterProjectCreation(project);
      await flushImmediate();

      expect(prisma.eligibilityAssessment.findFirst).not.toHaveBeenCalled();
      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("evaluates when there is no prior assessment", async () => {
      const project = buildProject();
      prisma.eligibilityAssessment.findFirst.mockResolvedValue(null);

      await triggerEvaluationAfterProjectCreation(project);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("evaluates when the last assessment is older than the cooldown", async () => {
      const project = buildProject();
      prisma.eligibilityAssessment.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 60_000),
      });

      await triggerEvaluationAfterProjectCreation(project);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("rate-limits and does not evaluate when the last assessment is within the cooldown", async () => {
      const project = buildProject();
      prisma.eligibilityAssessment.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 5_000),
      });

      await triggerEvaluationAfterProjectCreation(project);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("logs a warning and swallows errors thrown by evaluateProjectEligibility", async () => {
      const project = buildProject();
      evaluateProjectEligibility.mockRejectedValue(new Error("boom"));

      await triggerEvaluationAfterProjectCreation(project);
      await flushImmediate();

      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe("triggerEvaluationAfterDraftUpdate", () => {
    const oldDraft = {
      province: "ON",
      ownershipStatus: "owner",
      clientConsentConfirmed: true,
      modificationItems: ["GRAB_BARS"],
      estimatedHouseholdIncome: 50000,
      age: 70,
      propertyYearBuilt: 1990,
      irrelevantField: "a",
    };

    it("short-circuits synchronously when project.isManualMode is true", async () => {
      const project = buildProject({ isManualMode: true });
      const newDraft = { ...oldDraft, province: "BC" };

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(prisma.eligibilityAssessment.findFirst).not.toHaveBeenCalled();
      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("no-ops synchronously when no relevant fields changed", async () => {
      const project = buildProject();
      const newDraft = { ...oldDraft, irrelevantField: "b" };

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(prisma.eligibilityAssessment.findFirst).not.toHaveBeenCalled();
      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it.each([
      ["province", "BC"],
      ["ownershipStatus", "tenant"],
      ["clientConsentConfirmed", false],
      ["modificationItems", ["STAIR_LIFT"]],
      ["estimatedHouseholdIncome", 60000],
      ["age", 71],
      ["propertyYearBuilt", 1995],
    ])("evaluates when %s changes", async (field, newValue) => {
      const project = buildProject();
      const newDraft = { ...oldDraft, [field]: newValue };
      prisma.project.findUnique.mockResolvedValue(project);

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("treats missing/null oldDraft as a change (evaluates)", async () => {
      const project = buildProject();
      prisma.project.findUnique.mockResolvedValue(project);

      await triggerEvaluationAfterDraftUpdate(project, null, oldDraft);
      await flushImmediate();

      expect(evaluateProjectEligibility).toHaveBeenCalledWith(project);
    });

    it("treats both drafts missing as no change (no-op)", async () => {
      const project = buildProject();

      await triggerEvaluationAfterDraftUpdate(project, null, undefined);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("rate-limits and does not evaluate within the cooldown window", async () => {
      const project = buildProject();
      const newDraft = { ...oldDraft, province: "BC" };
      prisma.eligibilityAssessment.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 1_000),
      });

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(prisma.project.findUnique).not.toHaveBeenCalled();
      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("refreshes the project and evaluates with the freshly-fetched record", async () => {
      const project = buildProject();
      const newDraft = { ...oldDraft, province: "BC" };
      const refreshedProject = buildProject({ draftData: newDraft });
      prisma.project.findUnique.mockResolvedValue(refreshedProject);

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: project.id } });
      expect(evaluateProjectEligibility).toHaveBeenCalledWith(refreshedProject);
    });

    it("does not evaluate when the refreshed project can no longer be found", async () => {
      const project = buildProject();
      const newDraft = { ...oldDraft, province: "BC" };
      prisma.project.findUnique.mockResolvedValue(null);

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(evaluateProjectEligibility).not.toHaveBeenCalled();
    });

    it("logs a warning and swallows errors thrown during re-evaluation", async () => {
      const project = buildProject();
      const newDraft = { ...oldDraft, province: "BC" };
      prisma.project.findUnique.mockResolvedValue(project);
      evaluateProjectEligibility.mockRejectedValue(new Error("boom"));

      await triggerEvaluationAfterDraftUpdate(project, oldDraft, newDraft);
      await flushImmediate();

      expect(consoleWarnSpy).toHaveBeenCalled();
    });
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
