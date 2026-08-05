/**
 * @jest-environment node
 */
export {};

const mockGroupBy = jest.fn();
const mockAdminDigestRunCreate = jest.fn();
const mockAdminDigestRunFindFirst = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    securityEvent: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
    adminDigestRun: {
      create: (...args: unknown[]) => mockAdminDigestRunCreate(...args),
      findFirst: (...args: unknown[]) => mockAdminDigestRunFindFirst(...args),
    },
  },
}));

jest.mock("@/backend/auth/requireRole", () => ({
  parseAllowedEmails: jest.fn(),
}));

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

const { parseAllowedEmails } = require("@/backend/auth/requireRole");
const { sendTransactionalEmail } = require("@/backend/services/transactionalEmail");
const { buildDailyDigest, sendDailyDigest, runCatchUpIfNeeded } = require("../adminDigest");

describe("buildDailyDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});

describe("sendDailyDigest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminDigestRunCreate.mockResolvedValue({});
  });

  it("emails every allowlisted admin with the aggregated counts", async () => {
    mockGroupBy.mockResolvedValue([
      { eventType: "RATE_LIMIT_HIT", scope: "login-ip", _count: { _all: 5 } },
    ]);
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test", "b@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@landseed.test",
        subject: expect.stringContaining("5 event(s)"),
        text: expect.stringContaining("RATE_LIMIT_HIT / login-ip: 5"),
      })
    );
  });

  it("still sends a 'no events' digest when nothing happened", async () => {
    mockGroupBy.mockResolvedValue([]);
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date());

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("no rate-limit hits or alerts") })
    );
  });

  it("does not throw when no admins are configured", async () => {
    mockGroupBy.mockResolvedValue([]);
    (parseAllowedEmails as jest.Mock).mockReturnValue([]);

    await expect(sendDailyDigest(new Date())).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still records a run when no admins are configured, so catch-up doesn't retry forever", async () => {
    mockGroupBy.mockResolvedValue([]);
    (parseAllowedEmails as jest.Mock).mockReturnValue([]);

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"));

    expect(mockAdminDigestRunCreate).toHaveBeenCalledWith({
      data: {
        windowStart: new Date("2026-08-04T13:00:00.000Z"),
        windowEnd: new Date("2026-08-05T13:00:00.000Z"),
        eventCount: 0,
      },
    });
  });

  it("does not throw when building the digest fails, and does not record a run", async () => {
    mockGroupBy.mockRejectedValue(new Error("db down"));
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);

    await expect(sendDailyDigest(new Date())).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(mockAdminDigestRunCreate).not.toHaveBeenCalled();
  });

  it("labels a catch-up send distinctly and uses the given windowStart", async () => {
    mockGroupBy.mockResolvedValue([]);
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendDailyDigest(new Date("2026-08-05T13:00:00.000Z"), {
      windowStart: new Date("2026-08-02T13:00:00.000Z"),
      isCatchUp: true,
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("Catch-up") })
    );
  });
});

describe("runCatchUpIfNeeded", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminDigestRunCreate.mockResolvedValue({});
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
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);
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
