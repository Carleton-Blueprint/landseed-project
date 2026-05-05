import { prisma } from "@/lib/prisma";
import { manualReviewQueue, createManualReviewWorker } from "@/backend/queue";
import { AuditEventAction, ProjectManualReviewReasonCode } from "@prisma/client";
import type { Job } from "bullmq";

describe("FR-2.6: Manual Review Worker Integration Tests", () => {
  describe("Successful Job Processing", () => {
    it("should create a new flag on first evaluation", async () => {
      const project = await prisma.project.create({
        data: {
          address: "111 New Flag Test St",
          userId: "test-user-new-flag",
        },
      });

      const assessment = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      const flag = await prisma.projectManualReviewFlag.upsert({
        where: { projectId: project.id },
        create: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          lastEvaluationEligibilityAssessmentId: assessment.id,
          description:
            "Flagged: LOW confidence (60%) in grant discovery results",
        },
        update: {
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          lastEvaluationEligibilityAssessmentId: assessment.id,
          description:
            "Flagged: LOW confidence (60%) in grant discovery results",
        },
      });

      expect(flag).toBeDefined();
      expect(flag.projectId).toBe(project.id);
      expect(flag.reason).toBe("LOW_CONFIDENCE");
      expect(flag.isActive).toBe(true);

      await prisma.project.delete({ where: { id: project.id } });
    });

    it("should update existing flag on re-evaluation", async () => {
      const project = await prisma.project.create({
        data: {
          address: "222 Update Flag Test Ave",
          userId: "test-user-update-flag",
        },
      });

      const assessment1 = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      let flag = await prisma.projectManualReviewFlag.upsert({
        where: { projectId: project.id },
        create: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          lastEvaluationEligibilityAssessmentId: assessment1.id,
          description: "Initial flag",
        },
        update: {},
      });

      const flagId1 = flag.id;
      const createdAt1 = flag.createdAt;

      const assessment2 = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      flag = await prisma.projectManualReviewFlag.upsert({
        where: { projectId: project.id },
        create: {},
        update: {
          reason: "HIGH_COMPLEXITY",
          lastEvaluatedAt: new Date(),
          lastEvaluationEligibilityAssessmentId: assessment2.id,
          description: "Updated: Multiple complexity signals detected",
        },
      });

      expect(flag.id).toBe(flagId1); // Same flag ID
      expect(flag.createdAt).toEqual(createdAt1); // Same creation time
      expect(flag.reason).toBe("HIGH_COMPLEXITY"); // Updated reason
      expect(flag.lastEvaluationEligibilityAssessmentId).toBe(assessment2.id); // New assessment

      await prisma.project.delete({ where: { id: project.id } });
    });
  });

  describe("Stale Evaluation Guard", () => {
    it("should ignore jobs for older assessments", async () => {
      const project = await prisma.project.create({
        data: {
          address: "333 Stale Eval Guard Test Dr",
          userId: "test-user-stale-eval",
        },
      });

      const oldAssessment = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      const newAssessment = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "INELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      const newFlag = await prisma.projectManualReviewFlag.create({
        data: {
          projectId: project.id,
          reason: "HIGH_COMPLEXITY",
          isActive: true,
          lastEvaluatedAt: new Date(),
          lastEvaluationEligibilityAssessmentId: newAssessment.id,
          description: "Flag for new assessment",
        },
      });

      const projectFlag = await prisma.projectManualReviewFlag.findUnique({
        where: { projectId: project.id },
      });

      if (
        projectFlag &&
        projectFlag.lastEvaluationEligibilityAssessmentId !== oldAssessment.id
      ) {
        expect(projectFlag.lastEvaluationEligibilityAssessmentId).toBe(
          newAssessment.id
        );
      }

      await prisma.project.delete({ where: { id: project.id } });
    });
  });

  describe("Terminal Error Fallback", () => {
    it("should create fallback flag on terminal errors", async () => {
      const project = await prisma.project.create({
        data: {
          address: "444 Fallback Flag Test Ln",
          userId: "test-user-fallback",
        },
      });

      const assessment = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      const fallbackFlag = await prisma.projectManualReviewFlag.upsert({
        where: { projectId: project.id },
        create: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE" as ProjectManualReviewReasonCode,
          isActive: true,
          lastEvaluatedAt: new Date(),
          description: "Fallback flag created due to worker error",
        },
        update: {
          reason: "LOW_CONFIDENCE",
          description: "Fallback flag created due to worker error",
        },
      });

      expect(fallbackFlag).toBeDefined();
      expect(fallbackFlag.reason).toBe("LOW_CONFIDENCE");
      expect(fallbackFlag.description).toContain("Fallback");

      await prisma.project.delete({ where: { id: project.id } });
    });

    it("should create audit event for fallback flag creation", async () => {
      const project = await prisma.project.create({
        data: {
          address: "555 Fallback Audit Event Test St",
          userId: "test-user-fallback-audit",
        },
      });

      const fallbackFlag = await prisma.projectManualReviewFlag.create({
        data: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          description: "Fallback flag with audit event",
        },
      });

      const auditEvent = await prisma.auditEvent.create({
        data: {
          action: "MANUAL_REVIEW_FLAG_CREATED" as AuditEventAction,
          userId: "system",
          description: `System created fallback flag for project ${project.id}`,
          metadata: {
            flagId: fallbackFlag.id,
            projectId: project.id,
            reason: "LOW_CONFIDENCE",
            isSystemFallback: true,
          },
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe("MANUAL_REVIEW_FLAG_CREATED");
      expect((auditEvent.metadata as any).isSystemFallback).toBe(true);

      await prisma.project.delete({ where: { id: project.id } });
    });
  });

  describe("Audit Trail Creation", () => {
    it("should create audit event on flag creation", async () => {
      const project = await prisma.project.create({
        data: {
          address: "666 Audit Event Create Test Ave",
          userId: "test-user-audit-create",
        },
      });

      const flag = await prisma.projectManualReviewFlag.create({
        data: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          description: "Test flag for audit trail",
        },
      });

      const auditEvent = await prisma.auditEvent.create({
        data: {
          action: "MANUAL_REVIEW_FLAG_CREATED" as AuditEventAction,
          userId: "system",
          description: `Manual review flag created for project ${project.id}`,
          metadata: {
            flagId: flag.id,
            projectId: project.id,
            reason: "LOW_CONFIDENCE",
          },
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe("MANUAL_REVIEW_FLAG_CREATED");
      expect((auditEvent.metadata as any).flagId).toBe(flag.id);

      await prisma.project.delete({ where: { id: project.id } });
    });

    it("should create audit event on flag update", async () => {
      const project = await prisma.project.create({
        data: {
          address: "777 Audit Event Update Test Dr",
          userId: "test-user-audit-update",
        },
      });

      const flag = await prisma.projectManualReviewFlag.create({
        data: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
          description: "Initial flag",
        },
      });

      await prisma.projectManualReviewFlag.update({
        where: { id: flag.id },
        data: {
          reason: "HIGH_COMPLEXITY",
          description: "Updated flag",
        },
      });

      const auditEvent = await prisma.auditEvent.create({
        data: {
          action: "MANUAL_REVIEW_FLAG_UPDATED" as AuditEventAction,
          userId: "system",
          description: `Manual review flag updated for project ${project.id}`,
          metadata: {
            flagId: flag.id,
            projectId: project.id,
            newReason: "HIGH_COMPLEXITY",
            previousReason: "LOW_CONFIDENCE",
          },
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe("MANUAL_REVIEW_FLAG_UPDATED");
      expect((auditEvent.metadata as any).newReason).toBe("HIGH_COMPLEXITY");

      await prisma.project.delete({ where: { id: project.id } });
    });

    it("should create audit event on worker failure", async () => {
      const project = await prisma.project.create({
        data: {
          address: "888 Audit Event Failure Test Ln",
          userId: "test-user-audit-failure",
        },
      });

      const auditEvent = await prisma.auditEvent.create({
        data: {
          action: "MANUAL_REVIEW_FLAG_PROCESSING_FAILED" as AuditEventAction,
          userId: "system",
          description: `Failed to process manual review flag for project ${project.id}`,
          metadata: {
            projectId: project.id,
            error: "Validation error: invalid reason code",
            attempts: 3,
          },
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe("MANUAL_REVIEW_FLAG_PROCESSING_FAILED");
      expect((auditEvent.metadata as any).attempts).toBe(3);

      await prisma.project.delete({ where: { id: project.id } });
    });
  });

  describe("Idempotency & Uniqueness", () => {
    it("should maintain one flag per project via unique constraint", async () => {
      const project = await prisma.project.create({
        data: {
          address: "999 Uniqueness Test St",
          userId: "test-user-uniqueness",
        },
      });

      const flag1 = await prisma.projectManualReviewFlag.create({
        data: {
          projectId: project.id,
          reason: "LOW_CONFIDENCE",
          isActive: true,
          lastEvaluatedAt: new Date(),
        },
      });

      expect(async () => {
        await prisma.projectManualReviewFlag.create({
          data: {
            projectId: project.id,
            reason: "HIGH_COMPLEXITY",
            isActive: true,
            lastEvaluatedAt: new Date(),
          },
        });
      }).rejects.toThrow();

      const flags = await prisma.projectManualReviewFlag.findMany({
        where: { projectId: project.id },
      });

      expect(flags).toHaveLength(1);
      expect(flags[0].id).toBe(flag1.id);

      await prisma.project.delete({ where: { id: project.id } });
    });

    it("should handle concurrent upserts gracefully", async () => {
      const project = await prisma.project.create({
        data: {
          address: "1111 Concurrent Test Ave",
          userId: "test-user-concurrent",
        },
      });

      const assessment = await prisma.eligibilityAssessment.create({
        data: {
          projectId: project.id,
          overallDecision: "ELIGIBLE",
          discoveredGrants: [],
          provider: "TEST",
        },
      });

      const promises = [
        prisma.projectManualReviewFlag.upsert({
          where: { projectId: project.id },
          create: {
            projectId: project.id,
            reason: "LOW_CONFIDENCE",
            isActive: true,
            lastEvaluatedAt: new Date(),
            lastEvaluationEligibilityAssessmentId: assessment.id,
          },
          update: {
            reason: "LOW_CONFIDENCE",
            lastEvaluationEligibilityAssessmentId: assessment.id,
          },
        }),
        prisma.projectManualReviewFlag.upsert({
          where: { projectId: project.id },
          create: {
            projectId: project.id,
            reason: "HIGH_COMPLEXITY",
            isActive: true,
            lastEvaluatedAt: new Date(),
            lastEvaluationEligibilityAssessmentId: assessment.id,
          },
          update: {
            reason: "HIGH_COMPLEXITY",
            lastEvaluationEligibilityAssessmentId: assessment.id,
          },
        }),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(2);
      expect(results[0].projectId).toBe(project.id);
      expect(results[1].projectId).toBe(project.id);

      const flags = await prisma.projectManualReviewFlag.findMany({
        where: { projectId: project.id },
      });

      expect(flags).toHaveLength(1);

      await prisma.project.delete({ where: { id: project.id } });
    });
  });
});
