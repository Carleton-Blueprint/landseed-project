import {
  get7DayRemindersForUser,
  get14DayEstimateRemindersForUser,
  getDashboardReminders,
} from "../reminders";
import { prisma } from "lib/prisma";

jest.mock("lib/prisma", () => ({
  prisma: {
    project: {
      findMany: jest.fn(),
    },
    eligibilityAssessment: {
      findFirst: jest.fn(),
    },
  },
}));

describe("get7DayRemindersForUser", () => {
  const mockUserId = "test-user-123";
  const now = new Date();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return a reminder when an assessment is in NEEDS_MORE_INFO, older than 7 days, and no new uploads exist", async () => {
    const mockProject = {
      id: "project-1",
      address: "123 Test St",
      photos: [
        { id: "photo-old", createdAt: new Date(eightDaysAgo.getTime() - 1000) }
      ],
      documents: [
        { id: "doc-old", createdAt: new Date(eightDaysAgo.getTime() - 1000) }
      ],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "NEEDS_MORE_INFO",
      missingRequirements: JSON.stringify(["photo"]),
      isLatest: true,
      createdAt: eightDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await get7DayRemindersForUser(mockUserId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "reminder-7d-project-1-assessment-1",
      kind: "action_required",
      title: "Additional photos requested",
      body: `Additional photos requested by the advisory team on ${eightDaysAgo.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}`,
      href: "/dashboard/project-1",
      createdAt: eightDaysAgo.toISOString(),
      urgent: true,
      read: false,
    });
  });

  it("should not return a reminder if the assessment is in NEEDS_MORE_INFO but is newer than 7 days", async () => {
    const mockProject = {
      id: "project-1",
      address: "123 Test St",
      photos: [],
      documents: [],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "NEEDS_MORE_INFO",
      missingRequirements: JSON.stringify(["photo"]),
      isLatest: true,
      createdAt: sixDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await get7DayRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });

  it("should not return a reminder if the assessment is in NEEDS_MORE_INFO but new photos are uploaded after the request date", async () => {
    const mockProject = {
      id: "project-1",
      address: "123 Test St",
      photos: [
        { id: "photo-new", createdAt: now } // Uploaded today (after request date)
      ],
      documents: [],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "NEEDS_MORE_INFO",
      missingRequirements: JSON.stringify(["photo"]),
      isLatest: true,
      createdAt: eightDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await get7DayRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });

  it("should not return a reminder if the assessment is in NEEDS_MORE_INFO but new documents are uploaded after the request date", async () => {
    const mockProject = {
      id: "project-1",
      address: "123 Test St",
      photos: [],
      documents: [
        { id: "doc-new", createdAt: now } // Uploaded today (after request date)
      ],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "NEEDS_MORE_INFO",
      missingRequirements: JSON.stringify(["income_proof"]),
      isLatest: true,
      createdAt: eightDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await get7DayRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });

  it("should not return a reminder if the overallDecision is not NEEDS_MORE_INFO", async () => {
    const mockProject = {
      id: "project-1",
      address: "123 Test St",
      photos: [],
      documents: [],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "ELIGIBLE",
      missingRequirements: JSON.stringify([]),
      isLatest: true,
      createdAt: eightDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await get7DayRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });
});

describe("get14DayEstimateRemindersForUser", () => {
  const mockUserId = "test-user-123";
  const now = new Date();
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return a reminder for a pending quote with 15 days of inactivity", async () => {
    const mockProject = {
      id: "project-1",
      address: "456 Oak Ave",
      quotes: [
        {
          id: "quote-1",
          status: "PENDING",
          generatedAt: fifteenDaysAgo,
          lastClientActivityAt: fifteenDaysAgo,
        }
      ],
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);

    const result = await get14DayEstimateRemindersForUser(mockUserId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "reminder-14d-estimate-quote-1",
      kind: "action_required",
      title: "Estimate Expiring Soon",
      body: `Refined Estimate for 456 Oak Ave, delivered on ${fifteenDaysAgo.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}, will expire after 30 days of inactivity.`,
      href: "/projects/project-1/estimate",
      createdAt: fifteenDaysAgo.toISOString(),
      urgent: true,
      read: false,
    });
  });

  it("should not return a reminder if client activity was less than 14 days ago", async () => {
    const mockProject = {
      id: "project-1",
      address: "456 Oak Ave",
      quotes: [
        {
          id: "quote-1",
          status: "PENDING",
          generatedAt: fiveDaysAgo,
          lastClientActivityAt: fiveDaysAgo,
        }
      ],
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);

    const result = await get14DayEstimateRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });

  it("should not return a reminder if the quote has been inactive for 30 or more days (expired)", async () => {
    const mockProject = {
      id: "project-1",
      address: "456 Oak Ave",
      quotes: [
        {
          id: "quote-1",
          status: "PENDING",
          generatedAt: thirtyOneDaysAgo,
          lastClientActivityAt: thirtyOneDaysAgo,
        }
      ],
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);

    const result = await get14DayEstimateRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });

  it("should not return a reminder if the quote status is ACCEPTED or DECLINED", async () => {
    const mockProjectAccepted = {
      id: "project-1",
      address: "456 Oak Ave",
      quotes: [
        {
          id: "quote-1",
          status: "ACCEPTED",
          generatedAt: fifteenDaysAgo,
          lastClientActivityAt: fifteenDaysAgo,
        }
      ],
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProjectAccepted]);

    const result = await get14DayEstimateRemindersForUser(mockUserId);
    expect(result).toHaveLength(0);
  });
});

describe("getDashboardReminders", () => {
  const mockUserId = "test-user-123";
  const now = new Date();
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  it("should combine output from get7DayRemindersForUser and get14DayEstimateRemindersForUser", async () => {
    const mockProject = {
      id: "project-1",
      address: "789 Pine Rd",
      photos: [],
      documents: [],
      quotes: [
        {
          id: "quote-1",
          status: "PENDING",
          generatedAt: fifteenDaysAgo,
          lastClientActivityAt: fifteenDaysAgo,
        }
      ],
    };

    const mockAssessment = {
      id: "assessment-1",
      projectId: "project-1",
      overallDecision: "NEEDS_MORE_INFO",
      missingRequirements: JSON.stringify(["photo"]),
      isLatest: true,
      createdAt: fifteenDaysAgo,
    };

    (prisma.project.findMany as jest.Mock).mockResolvedValue([mockProject]);
    (prisma.eligibilityAssessment.findFirst as jest.Mock).mockResolvedValue(mockAssessment);

    const result = await getDashboardReminders(mockUserId);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("reminder-7d-project-1-assessment-1");
    expect(result[1].id).toBe("reminder-14d-estimate-quote-1");
  });
});
