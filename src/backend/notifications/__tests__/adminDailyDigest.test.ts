import {
  collectAdminDailyDigestData,
  sendAdminDailyDigest,
} from "@/backend/notifications/adminDailyDigest";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { prisma } from "lib/prisma";

jest.mock("lib/prisma", () => ({
  prisma: {
    grantApplicationStatusHistory: {
      findMany: jest.fn(),
    },
    projectManualReviewFlag: {
      findMany: jest.fn(),
    },
    builderTrendTransfer: {
      findMany: jest.fn(),
    },
    project: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

const mockedPrisma = prisma as any;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<
  typeof sendTransactionalEmail
>;

describe("Admin daily digest", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.ADMIN_DAILY_DIGEST_ENABLED;
    delete process.env.ADMIN_DAILY_DIGEST_RECIPIENTS;
    delete process.env.ADVISORY_TEAM_EMAILS;
  });

  it("collects new submissions, staff actions, and at-risk items", async () => {
    const now = new Date("2026-07-05T12:00:00.000Z");
    const since = new Date("2026-07-04T12:00:00.000Z");

    mockedPrisma.grantApplicationStatusHistory.findMany.mockResolvedValue([
      {
        projectId: "project-1",
        changedAt: new Date("2026-07-04T14:00:00.000Z"),
        project: {
          id: "project-1",
          address: "100 Main St",
          status: "submitted",
          user: {
            name: "Jane Doe",
            email: "jane@example.com",
            phone: null,
          },
        },
      },
    ] as any);

    mockedPrisma.projectManualReviewFlag.findMany.mockResolvedValue([
      {
        projectId: "project-2",
        description: "Low confidence",
        createdAt: new Date("2026-07-05T10:00:00.000Z"),
        project: {
          id: "project-2",
          address: "200 Oak Ave",
          status: "submitted",
          user: {
            name: "John Doe",
            email: "john@example.com",
            phone: "555-0000",
          },
        },
      },
    ] as any);

    mockedPrisma.builderTrendTransfer.findMany.mockResolvedValue([
      {
        id: "transfer-1",
        status: "FAILED",
        projectId: "project-3",
        project: {
          id: "project-3",
          address: "300 Pine Rd",
          status: "submitted",
          user: {
            name: "Sam Lee",
            email: "sam@example.com",
            phone: "555-1111",
          },
        },
      },
    ] as any);

    mockedPrisma.project.findMany.mockResolvedValue([
      {
        id: "project-4",
        address: "400 Elm St",
        status: "submitted",
        createdAt: new Date("2026-07-04T22:00:00.000Z"),
        user: {
          name: "Pat Smith",
          email: null,
          phone: null,
        },
      },
    ] as any);

    const result = await collectAdminDailyDigestData({ now, since });

    expect(result.newSubmissions).toHaveLength(1);
    expect(result.pendingStaffActions).toHaveLength(3);
    expect(result.atRiskItems).toHaveLength(1);
    expect(result.newSubmissions[0].projectId).toBe("project-1");
    expect(result.pendingStaffActions[0].reason).toBe("MANUAL_REVIEW");
  });

  it("skips sending when disabled or when no recipients are configured", async () => {
    process.env.ADMIN_DAILY_DIGEST_ENABLED = "false";
    process.env.ADMIN_DAILY_DIGEST_RECIPIENTS = "";
    process.env.ADVISORY_TEAM_EMAILS = "";

    const result = await sendAdminDailyDigest({ now: new Date("2026-07-05T12:00:00.000Z") });

    expect(result.sentCount).toBe(0);
    expect(mockedSendTransactionalEmail).not.toHaveBeenCalled();
  });
});
