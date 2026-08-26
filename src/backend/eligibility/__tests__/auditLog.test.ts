import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("lib/prisma", () => ({
  prisma: {
    auditEvent: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

type AuditHistoryRow = {
  id: string;
  action: string;
  outcome: string;
  description: string;
  createdAt: Date;
  actorUser: { email: string; name: string } | null;
  metadata: unknown;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require("lib/prisma") as {
  prisma: { auditEvent: { findMany: jest.Mock<(...args: unknown[]) => Promise<AuditHistoryRow[]>> } };
};
const { logAuditEventNonBlocking } = require("@/backend/audit/log") as {
  logAuditEventNonBlocking: jest.Mock<(...args: unknown[]) => Promise<void>>;
};

const {
  logEligibilityAssessmentCreated,
  logEligibilityDecisionChanged,
  logEligibilityAssessmentReviewed,
  logEligibilityReEvaluation,
  logEligibilityNeedsMoreInfo,
  logEligibilityAssessmentError,
  getEligibilityAuditHistory,
} = require("../auditLog") as typeof import("../auditLog");

import { EligibilityDecision } from "../types";

describe("auditLog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("logEligibilityAssessmentCreated", () => {
    it("builds the correct audit event", async () => {
      const project = { id: "project-1" } as never;
      const assessment = {
        assessmentId: "assessment-1",
        overallDecision: EligibilityDecision.ELIGIBLE,
        programDecisions: { CMHC: EligibilityDecision.ELIGIBLE },
        reasonCodes: ["SOME_CODE"],
        missingRequirements: [],
      } as never;
      const performedBy = { id: "user-1" } as never;

      await logEligibilityAssessmentCreated(project, assessment, performedBy);

      expect(logAuditEventNonBlocking).toHaveBeenCalledTimes(1);
      expect(logAuditEventNonBlocking).toHaveBeenCalledWith({
        category: "MANUAL_CHANGE",
        action: "ELIGIBILITY_ASSESSMENT_CREATED",
        outcome: "SUCCESS",
        sensitivityLevel: "CONFIDENTIAL",
        projectId: "project-1",
        actorUserId: "user-1",
        resourceType: "EligibilityAssessment",
        resourceId: "assessment-1",
        description: `Eligibility assessment created: ${EligibilityDecision.ELIGIBLE}`,
        metadata: {
          overallDecision: EligibilityDecision.ELIGIBLE,
          programDecisions: { CMHC: EligibilityDecision.ELIGIBLE },
          reasonCodes: ["SOME_CODE"],
          missingRequirements: [],
        },
      });
    });
  });

  describe("logEligibilityDecisionChanged", () => {
    it("builds the correct audit event with performedBy provided", async () => {
      const performedBy = { id: "user-2" } as never;

      await logEligibilityDecisionChanged(
        "project-2",
        "assessment-2",
        EligibilityDecision.NEEDS_MORE_INFO,
        EligibilityDecision.ELIGIBLE,
        performedBy
      );

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith({
        category: "MANUAL_CHANGE",
        action: "ELIGIBILITY_DECISION_CHANGED",
        outcome: "SUCCESS",
        sensitivityLevel: "CONFIDENTIAL",
        projectId: "project-2",
        actorUserId: "user-2",
        resourceType: "EligibilityAssessment",
        resourceId: "assessment-2",
        description: `Eligibility decision changed: ${EligibilityDecision.NEEDS_MORE_INFO} → ${EligibilityDecision.ELIGIBLE}`,
        beforeState: { decision: EligibilityDecision.NEEDS_MORE_INFO },
        afterState: { decision: EligibilityDecision.ELIGIBLE },
        metadata: {
          oldDecision: EligibilityDecision.NEEDS_MORE_INFO,
          newDecision: EligibilityDecision.ELIGIBLE,
        },
      });
    });

    it("omits actorUserId when performedBy is not provided", async () => {
      await logEligibilityDecisionChanged(
        "project-3",
        "assessment-3",
        EligibilityDecision.INELIGIBLE,
        EligibilityDecision.MANUAL_REVIEW
      );

      const call = logAuditEventNonBlocking.mock.calls[0][0] as Record<string, unknown>;
      expect(call.actorUserId).toBeUndefined();
      expect(call.projectId).toBe("project-3");
    });
  });

  describe("logEligibilityAssessmentReviewed", () => {
    it("includes notes in description and metadata when provided", async () => {
      const reviewedBy = { id: "user-4", email: "staff@example.com" } as never;

      await logEligibilityAssessmentReviewed(
        "project-4",
        "assessment-4",
        reviewedBy,
        "Looks good"
      );

      const call = logAuditEventNonBlocking.mock.calls[0][0] as {
      category: string;
      action: string;
      outcome: string;
      sensitivityLevel: string;
      projectId: string;
      actorUserId?: string;
      resourceType: string;
      resourceId: string;
      description: string;
      metadata: { reviewedBy?: string; reviewNotes?: string; timestamp?: string };
    };
      expect(call.category).toBe("SENSITIVE_ACCESS");
      expect(call.action).toBe("ELIGIBILITY_ASSESSMENT_REVIEWED");
      expect(call.outcome).toBe("SUCCESS");
      expect(call.sensitivityLevel).toBe("CONFIDENTIAL");
      expect(call.projectId).toBe("project-4");
      expect(call.actorUserId).toBe("user-4");
      expect(call.resourceType).toBe("EligibilityAssessment");
      expect(call.resourceId).toBe("assessment-4");
      expect(call.description).toBe("Staff reviewed eligibility assessment: Looks good");
      expect(call.metadata.reviewedBy).toBe("staff@example.com");
      expect(call.metadata.reviewNotes).toBe("Looks good");
      expect(typeof call.metadata.timestamp).toBe("string");
    });

    it("omits notes suffix in description when notes are not provided", async () => {
      const reviewedBy = { id: "user-5", email: "staff2@example.com" } as never;

      await logEligibilityAssessmentReviewed("project-5", "assessment-5", reviewedBy);

      const call = logAuditEventNonBlocking.mock.calls[0][0] as {
      category: string;
      action: string;
      outcome: string;
      sensitivityLevel: string;
      projectId: string;
      actorUserId?: string;
      resourceType: string;
      resourceId: string;
      description: string;
      metadata: { reviewedBy?: string; reviewNotes?: string; timestamp?: string };
    };
      expect(call.description).toBe("Staff reviewed eligibility assessment");
      expect(call.metadata.reviewNotes).toBeUndefined();
    });
  });

  describe("logEligibilityReEvaluation", () => {
    it("builds the correct audit event", async () => {
      await logEligibilityReEvaluation(
        "project-6",
        "old-assessment-6",
        "new-assessment-6",
        EligibilityDecision.NEEDS_MORE_INFO,
        EligibilityDecision.ELIGIBLE,
        "New income data provided"
      );

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith({
        category: "MANUAL_CHANGE",
        action: "ELIGIBILITY_REEVALUATED",
        outcome: "SUCCESS",
        sensitivityLevel: "CONFIDENTIAL",
        projectId: "project-6",
        resourceType: "EligibilityAssessment",
        resourceId: "new-assessment-6",
        description: `Eligibility re-evaluated: ${EligibilityDecision.NEEDS_MORE_INFO} → ${EligibilityDecision.ELIGIBLE}. Reason: New income data provided`,
        beforeState: {
          assessmentId: "old-assessment-6",
          decision: EligibilityDecision.NEEDS_MORE_INFO,
        },
        afterState: {
          assessmentId: "new-assessment-6",
          decision: EligibilityDecision.ELIGIBLE,
        },
        metadata: {
          oldAssessmentId: "old-assessment-6",
          newAssessmentId: "new-assessment-6",
          oldDecision: EligibilityDecision.NEEDS_MORE_INFO,
          newDecision: EligibilityDecision.ELIGIBLE,
          reason: "New income data provided",
        },
      });
    });
  });

  describe("logEligibilityNeedsMoreInfo", () => {
    it("builds the correct audit event", async () => {
      await logEligibilityNeedsMoreInfo("project-7", "assessment-7", ["PROVINCE", "AGE"]);

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith({
        category: "MANUAL_CHANGE",
        action: "ELIGIBILITY_NEEDS_MORE_INFO",
        outcome: "SUCCESS",
        sensitivityLevel: "INTERNAL",
        projectId: "project-7",
        resourceType: "EligibilityAssessment",
        resourceId: "assessment-7",
        description: "Eligibility assessment requires more information: PROVINCE, AGE",
        metadata: {
          missingFields: ["PROVINCE", "AGE"],
        },
      });
    });
  });

  describe("logEligibilityAssessmentError", () => {
    it("builds the correct audit event with performedBy provided", async () => {
      const performedBy = { id: "user-8" } as never;

      await logEligibilityAssessmentError("project-8", "Discovery provider timed out", performedBy);

      expect(logAuditEventNonBlocking).toHaveBeenCalledWith({
        category: "SENSITIVE_ACCESS",
        action: "ELIGIBILITY_ASSESSMENT_FAILED",
        outcome: "FAILURE",
        sensitivityLevel: "INTERNAL",
        projectId: "project-8",
        actorUserId: "user-8",
        resourceType: "EligibilityAssessment",
        description: "Eligibility assessment failed: Discovery provider timed out",
        metadata: {
          error: "Discovery provider timed out",
        },
      });
    });

    it("omits actorUserId when performedBy is not provided", async () => {
      await logEligibilityAssessmentError("project-9", "Unknown failure");

      const call = logAuditEventNonBlocking.mock.calls[0][0] as Record<string, unknown>;
      expect(call.actorUserId).toBeUndefined();
    });
  });

  describe("getEligibilityAuditHistory", () => {
    it("queries with the expected action filter, ordering, and default limit, and maps rows", async () => {
      const createdAt = new Date("2026-01-01T00:00:00Z");
      prisma.auditEvent.findMany.mockResolvedValue([
        {
          id: "evt-1",
          action: "ELIGIBILITY_ASSESSMENT_CREATED",
          outcome: "SUCCESS",
          description: "desc",
          createdAt,
          actorUser: { email: "a@example.com", name: "A Name" },
          metadata: { foo: "bar" },
        },
      ]);

      const result = await getEligibilityAuditHistory("project-10");

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
        where: {
          projectId: "project-10",
          action: {
            in: [
              "ELIGIBILITY_ASSESSMENT_CREATED",
              "ELIGIBILITY_DECISION_CHANGED",
              "ELIGIBILITY_REEVALUATED",
              "ELIGIBILITY_ASSESSMENT_REVIEWED",
              "ELIGIBILITY_NEEDS_MORE_INFO",
            ],
          },
        },
        include: {
          actorUser: {
            select: {
              email: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      expect(result).toEqual([
        {
          id: "evt-1",
          action: "ELIGIBILITY_ASSESSMENT_CREATED",
          outcome: "SUCCESS",
          description: "desc",
          createdAt,
          actorEmail: "a@example.com",
          actorName: "A Name",
          metadata: { foo: "bar" },
        },
      ]);
    });

    it("respects a custom limit", async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);

      await getEligibilityAuditHistory("project-11", 5);

      expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it("maps rows with no actorUser to undefined actor fields", async () => {
      prisma.auditEvent.findMany.mockResolvedValue([
        {
          id: "evt-2",
          action: "ELIGIBILITY_NEEDS_MORE_INFO",
          outcome: "SUCCESS",
          description: "desc2",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          actorUser: null,
          metadata: null,
        },
      ]);

      const result = await getEligibilityAuditHistory("project-12");

      expect(result[0].actorEmail).toBeUndefined();
      expect(result[0].actorName).toBeUndefined();
    });

    it("returns an empty array and does not throw when the query rejects", async () => {
      prisma.auditEvent.findMany.mockRejectedValue(new Error("db unavailable"));
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const result = await getEligibilityAuditHistory("project-13");

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
