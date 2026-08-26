/**
 * @jest-environment node
 */
import { getAdminEmails } from "@/backend/auth/requireRole";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { buildDailyDigest, sendDailyDigest, runCatchUpIfNeeded } from "../adminDigest";

const mockGroupBy = jest.fn();
const mockProjectFindMany = jest.fn();
const mockManualReviewFlagFindMany = jest.fn();
const mockQuoteQuestionFindMany = jest.fn();
const mockAdminDigestRunCreate = jest.fn();
const mockAdminDigestRunFindFirst = jest.fn();
const mockDeliveryFailureCreateMany = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    securityEvent: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
    project: {
      findMany: (...args: unknown[]) => mockProjectFindMany(...args),
    },
    projectManualReviewFlag: {
      findMany: (...args: unknown[]) => mockManualReviewFlagFindMany(...args),
    },
    quoteQuestion: {
      findMany: (...args: unknown[]) => mockQuoteQuestionFindMany(...args),
    },
    adminDigestRun: {
      create: (...args: unknown[]) => mockAdminDigestRunCreate(...args),
      findFirst: (...args: unknown[]) => mockAdminDigestRunFindFirst(...args),
    },
    adminDigestDeliveryFailure: {
      createMany: (...args: unknown[]) => mockDeliveryFailureCreateMany(...args),
    },
  },
}));

jest.mock("@/backend/auth/requireRole", () => ({
  getAdminEmails: jest.fn(),
}));

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

function stubEmptyContent() {
  mockProjectFindMany.mockResolvedValue([]);
  mockManualReviewFlagFindMany.mockResolvedValue([]);
  mockQuoteQuestionFindMany.mockResolvedValue([]);
}

describe("buildDailyDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubEmptyContent();
  });

  it("groups SecurityEvent rows from the last 24h by eventType/scope", async () => {
    mockGroupBy.mockResolvedValue([
      { eventType: "RATE_LIMIT_HIT", scope: "login-ip", _count: { _all: 12 } },
      { eventType: "ALERT_TRIGGERED", scope: "ai-job-failure", _count: { _all: 2 } },
    ]);

    const windowEnd = new Date("2026-08-05T13:00:00.000Z");
    const digest = await buildDailyDigest(windowEnd);

    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["eventType", "scope"],
        where: {
          createdAt: {
            gte: new Date("2026-08-04T13:00:00.000Z"),
            lt: windowEnd,
          },
        },
      })
    );
    expect(digest.groups).toEqual([
      { eventType: "RATE_LIMIT_HIT", scope: "login-ip", count: 12 },
      { eventType: "ALERT_TRIGGERED", scope: "ai-job-failure", count: 2 },
    ]);
    expect(digest.totalEvents).toBe(14);
  });

  it("returns an empty digest when there are no events", async () => {
    mockGroupBy.mockResolvedValue([]);

    const digest = await buildDailyDigest(new Date());

    expect(digest.groups).toEqual([]);
    expect(digest.totalEvents).toBe(0);
    expect(digest.newSubmissions).toEqual([]);
    expect(digest.staffActionItems).toEqual([]);
  });

  it("includes projects created in the last 24h as new submissions", async () => {
    mockGroupBy.mockResolvedValue([]);
    const createdAt = new Date("2026-08-05T09:00:00.000Z");
    mockProjectFindMany.mockResolvedValue([{ id: "proj-1", address: "1 Main St", createdAt }]);

    const windowEnd = new Date("2026-08-05T13:00:00.000Z");
    const digest = await buildDailyDigest(windowEnd);

    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date("2026-08-04T13:00:00.000Z"), lt: windowEnd } },
      })
    );
    expect(digest.newSubmissions).toEqual([{ projectId: "proj-1", address: "1 Main St", createdAt }]);
  });

  it("includes active manual-review flags and open quote questions as staff action items", async () => {
    mockGroupBy.mockResolvedValue([]);
    mockManualReviewFlagFindMany.mockResolvedValue([
      { reason: "LOW_CONFIDENCE", project: { id: "proj-2", address: "2 Oak Ave" } },
    ]);
    mockQuoteQuestionFindMany.mockResolvedValue([
      { subject: "What's included?", quote: { project: { id: "proj-3", address: "3 Elm St" } } },
    ]);

    const digest = await buildDailyDigest(new Date());

    expect(digest.staffActionItems).toEqual([
      {
        projectId: "proj-2",
        address: "2 Oak Ave",
        reason: "Grant discovery returned low-confidence results",
      },
      {
        projectId: "proj-3",
        address: "3 Elm St",
        reason: "Open question: What's included?",
      },
    ]);
  });
});

describe("sendDailyDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubEmptyContent();
    mockAdminDigestRunCreate.mockResolvedValue({ id: "run-1" });
  });

  it("emails every allowlisted admin with the aggregated counts", async () => {
    mockGroupBy.mockResolvedValue([
      { eventType: "RATE_LIMIT_HIT", scope: "login-ip", _count: { _all: 5 } },
    ]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test", "b@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@landseed.test",
        text: expect.stringContaining("rate-limit hit (login-ip): 5"),
      })
    );
  });

  it("includes new submissions and staff action items in the subject and body", async () => {
    mockGroupBy.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([
      { id: "proj-1", address: "1 Main St", createdAt: new Date("2026-08-05T09:00:00.000Z") },
    ]);
    mockManualReviewFlagFindMany.mockResolvedValue([
      { reason: "HIGH_COMPLEXITY", project: { id: "proj-2", address: "2 Oak Ave" } },
    ]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("1 new request(s), 1 needs action"),
        text: expect.stringContaining("1 Main St"),
        html: expect.stringContaining("Needs staff action"),
      })
    );
  });

  it("still sends a 'nothing to report' digest when nothing happened", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date());

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("nothing to report") })
    );
  });

  it("does not throw when no admins are configured", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue([]);

    await expect(sendDailyDigest(new Date())).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still records a run when no admins are configured, so catch-up doesn't retry forever", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue([]);

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(mockAdminDigestRunCreate).toHaveBeenCalledWith({
      data: {
        windowStart: new Date("2026-08-04T13:00:00.000Z"),
        windowEnd: new Date("2026-08-05T13:00:00.000Z"),
        eventCount: 0,
        newSubmissionCount: 0,
        staffActionCount: 0,
      },
    });
  });

  it("does not throw when building the digest fails, and does not record a run", async () => {
    mockGroupBy.mockRejectedValue(new Error("db down"));
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);

    await expect(sendDailyDigest(new Date())).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(mockAdminDigestRunCreate).not.toHaveBeenCalled();
  });

  it("labels a catch-up send distinctly and uses the given windowStart", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"), {
      windowStart: new Date("2026-08-02T13:00:00.000Z"),
      isCatchUp: true,
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("Catch-up") })
    );
  });

  it("records a delivery failure with error details when a send fails", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test", "b@landseed.test"]);
    (sendTransactionalEmail as jest.Mock)
      .mockResolvedValueOnce({ provider: "resend" })
      .mockRejectedValueOnce(new Error("Resend 422: invalid recipient"));

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(mockDeliveryFailureCreateMany).toHaveBeenCalledWith({
      data: [
        {
          digestRunId: "run-1",
          recipientEmail: "b@landseed.test",
          errorMessage: "Resend 422: invalid recipient",
        },
      ],
    });
  });

  it("does not call the delivery-failure logger when every send succeeds", async () => {
    mockGroupBy.mockResolvedValue([]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(mockDeliveryFailureCreateMany).not.toHaveBeenCalled();
  });
});

describe("runCatchUpIfNeeded", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubEmptyContent();
    mockAdminDigestRunCreate.mockResolvedValue({ id: "run-1" });
  });

  it("does nothing for a brand-new deployment with no prior run", async () => {
    mockAdminDigestRunFindFirst.mockResolvedValue(null);

    const result = await runCatchUpIfNeeded(13, new Date("2026-08-05T14:00:00.000Z"));

    expect(result).toEqual({ sent: false });
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it("does nothing when the last run already covers the most recent scheduled time", async () => {
    mockAdminDigestRunFindFirst.mockResolvedValue({
      sentAt: new Date("2026-08-05T13:00:05.000Z"),
      windowStart: new Date("2026-08-04T13:00:00.000Z"),
      windowEnd: new Date("2026-08-05T13:00:00.000Z"),
      eventCount: 0,
    });

    // now is after today's 13:00 UTC target, but the last run already fired for it
    const result = await runCatchUpIfNeeded(13, new Date("2026-08-05T14:00:00.000Z"));

    expect(result).toEqual({ sent: false });
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it("sends a catch-up digest covering the gap when a scheduled run was missed", async () => {
    mockAdminDigestRunFindFirst.mockResolvedValue({
      sentAt: new Date("2026-08-03T13:00:05.000Z"),
      windowStart: new Date("2026-08-02T13:00:00.000Z"),
      windowEnd: new Date("2026-08-03T13:00:00.000Z"),
      eventCount: 4,
    });
    mockGroupBy.mockResolvedValue([
      { eventType: "RATE_LIMIT_HIT", scope: "login-ip", _count: { _all: 3 } },
    ]);
    (getAdminEmails as jest.Mock).mockResolvedValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    const now = new Date("2026-08-05T14:00:00.000Z");
    const result = await runCatchUpIfNeeded(13, now);

    expect(result).toEqual({ sent: true });
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date("2026-08-03T13:00:00.000Z"), lt: now } },
      })
    );
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("Catch-up") })
    );
  });

  it("does not throw when the check itself fails", async () => {
    mockAdminDigestRunFindFirst.mockRejectedValue(new Error("db down"));

    await expect(runCatchUpIfNeeded(13, new Date())).resolves.toEqual({ sent: false });
  });
});
