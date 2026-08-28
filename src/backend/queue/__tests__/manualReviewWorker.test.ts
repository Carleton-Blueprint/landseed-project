/**
 * Verifies the manual review worker's admin-alert wiring without touching
 * real Redis/Postgres: mocks bullmq/ioredis/prisma, then invokes the exported
 * job processor directly with fake job data.
 */
jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({})));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(function () {
    return {};
  }),
  Worker: jest.fn().mockImplementation(function () {
    return { on: jest.fn(), close: jest.fn() };
  }),
}));

jest.mock("lib/prisma", () => ({
  prisma: {
    project: { findUnique: jest.fn() },
    eligibilityAssessment: { findFirst: jest.fn() },
    projectManualReviewFlag: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: jest.fn(),
}));

jest.mock("@/backend/auth/requireRole", () => ({
  getAdminEmails: jest.fn(),
}));

jest.mock("@/backend/notifications/manualReviewNotificationContract", () => ({
  enqueueManualReviewFlagNotification: jest.fn(),
}));

import { prisma } from "lib/prisma";
import { logAuditEventNonBlocking } from "@/backend/audit/log";
import { getAdminEmails } from "@/backend/auth/requireRole";
import { enqueueManualReviewFlagNotification } from "@/backend/notifications/manualReviewNotificationContract";
import { processManualReviewJob } from "../manualReviewWorker";

const mockedPrisma = prisma as unknown as {
  project: { findUnique: jest.Mock };
  eligibilityAssessment: { findFirst: jest.Mock };
  projectManualReviewFlag: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
};
const mockedGetAdminEmails = getAdminEmails as jest.MockedFunction<typeof getAdminEmails>;
const mockedEnqueueNotification = enqueueManualReviewFlagNotification as jest.MockedFunction<
  typeof enqueueManualReviewFlagNotification
>;
const mockedLogAudit = logAuditEventNonBlocking as jest.MockedFunction<typeof logAuditEventNonBlocking>;

describe("manual review worker admin alerting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.project.findUnique.mockResolvedValue({ id: "project-1", address: "10 Main St" });
    mockedPrisma.eligibilityAssessment.findFirst.mockResolvedValue(null);
    mockedGetAdminEmails.mockResolvedValue(["admin1@example.com"]);
  });

  const baseJob = {
    data: {
      projectId: "project-1",
      aiConfidence: "LOW" as const,
      complexityScore: 2,
      reason: "LOW_CONFIDENCE",
    },
  };

  it("notifies admins when a new flag is created", async () => {
    mockedPrisma.projectManualReviewFlag.findUnique.mockResolvedValue(null);
    mockedPrisma.projectManualReviewFlag.create.mockResolvedValue({ id: "flag-1" });

    await processManualReviewJob(baseJob);

    expect(mockedGetAdminEmails).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        projectAddress: "10 Main St",
        flagId: "flag-1",
        reason: "LOW_CONFIDENCE",
        adminEmails: ["admin1@example.com"],
      })
    );
  });

  it("does not notify admins when an existing flag is only updated", async () => {
    mockedPrisma.projectManualReviewFlag.findUnique.mockResolvedValue({ id: "flag-1" });
    mockedPrisma.projectManualReviewFlag.update.mockResolvedValue({ id: "flag-1" });

    await processManualReviewJob(baseJob);

    expect(mockedGetAdminEmails).not.toHaveBeenCalled();
    expect(mockedEnqueueNotification).not.toHaveBeenCalled();
  });

  it("skips enqueueing when there are no admin emails", async () => {
    mockedPrisma.projectManualReviewFlag.findUnique.mockResolvedValue(null);
    mockedPrisma.projectManualReviewFlag.create.mockResolvedValue({ id: "flag-1" });
    mockedGetAdminEmails.mockResolvedValue([]);

    await processManualReviewJob(baseJob);

    expect(mockedEnqueueNotification).not.toHaveBeenCalled();
  });

  it("does not throw and logs an audit event when notification enqueueing fails", async () => {
    mockedPrisma.projectManualReviewFlag.findUnique.mockResolvedValue(null);
    mockedPrisma.projectManualReviewFlag.create.mockResolvedValue({ id: "flag-1" });
    mockedEnqueueNotification.mockRejectedValue(new Error("redis down"));

    await expect(processManualReviewJob(baseJob)).resolves.toBeUndefined();

    expect(mockedLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MANUAL_REVIEW_NOTIFICATION_FAILED",
        outcome: "FAILURE",
        projectId: "project-1",
      })
    );
  });
});
