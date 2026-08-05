/**
 * @jest-environment node
 */
export {};

const mockGroupBy = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    securityEvent: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
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
const { buildDailyDigest, sendDailyDigest } = require("../adminDigest");

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

  it("does not throw when building the digest fails", async () => {
    mockGroupBy.mockRejectedValue(new Error("db down"));
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);

    await expect(sendDailyDigest(new Date())).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
