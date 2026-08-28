/**
 * @jest-environment node
 */
import {
  getAllAlertThresholds,
  getAlertThreshold,
  updateAlertThreshold,
  invalidateAlertThresholdCache,
  AlertThresholdError,
  ALERT_THRESHOLD_KEYS,
  type AlertThresholdKey,
} from "../alertThresholds";

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();

jest.mock("lib/prisma", () => ({
  prisma: {
    alertThresholdConfig: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockLogAuditEventNonBlocking = jest.fn();
jest.mock("@/backend/audit/log", () => ({
  logAuditEventNonBlocking: (...args: unknown[]) => mockLogAuditEventNonBlocking(...args),
}));

describe("getAllAlertThresholds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAlertThresholdCache();
  });

  it("seeds any missing default keys, then returns all rows", async () => {
    mockFindMany
      .mockResolvedValueOnce([{ key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE }]) // existing-keys probe
      .mockResolvedValueOnce([
        { key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE, thresholdCount: 5, windowMinutes: 15, enabled: true },
        { key: ALERT_THRESHOLD_KEYS.BUILDERTREND_TRANSFER_FAILURE, thresholdCount: 3, windowMinutes: 15, enabled: true },
        { key: ALERT_THRESHOLD_KEYS.EMAIL_DELIVERY_FAILURE, thresholdCount: 5, windowMinutes: 15, enabled: true },
        { key: ALERT_THRESHOLD_KEYS.FILE_SCAN_FAILURE, thresholdCount: 5, windowMinutes: 15, enabled: true },
        { key: ALERT_THRESHOLD_KEYS.PRICING_TIER_FALLBACK, thresholdCount: 5, windowMinutes: 15, enabled: true },
        { key: ALERT_THRESHOLD_KEYS.GRANT_DISCOVERY_AI_FAILURE, thresholdCount: 5, windowMinutes: 15, enabled: true },
      ]); // full read after seeding
    mockUpsert.mockResolvedValue({});

    const rows = await getAllAlertThresholds();

    expect(mockUpsert).toHaveBeenCalledTimes(5); // the 5 defaults missing beyond AI_JOB_FAILURE
    expect(rows).toHaveLength(6);
  });

  it("skips seeding once all keys already exist", async () => {
    const allKeys = Object.values(ALERT_THRESHOLD_KEYS).map((key) => ({ key }));
    mockFindMany.mockResolvedValueOnce(allKeys).mockResolvedValueOnce(allKeys);

    await getAllAlertThresholds();

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("caches results across calls within the TTL", async () => {
    const allKeys = Object.values(ALERT_THRESHOLD_KEYS).map((key) => ({ key }));
    mockFindMany.mockResolvedValueOnce(allKeys).mockResolvedValueOnce(allKeys);

    await getAllAlertThresholds();
    await getAllAlertThresholds();

    // One probe + one full read = 2 calls total, not 4, on the second invocation being served from cache
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("getAlertThreshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAlertThresholdCache();
  });

  it("returns null for an unrecognized key", async () => {
    const allKeys = Object.values(ALERT_THRESHOLD_KEYS).map((key) => ({ key }));
    mockFindMany.mockResolvedValueOnce(allKeys).mockResolvedValueOnce(allKeys);

    const result = await getAlertThreshold("not-a-real-key" as AlertThresholdKey);

    expect(result).toBeNull();
  });
});

describe("updateAlertThreshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAlertThresholdCache();
    const allKeys = Object.values(ALERT_THRESHOLD_KEYS).map((key) => ({ key }));
    mockFindMany.mockResolvedValue(allKeys);
  });

  it("throws NOT_FOUND for an unknown key", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(
      updateAlertThreshold({ key: "bogus", actorUserId: "admin-1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-positive thresholdCount", async () => {
    mockFindUnique.mockResolvedValue({
      id: "row-1",
      key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: true,
    });

    await expect(
      updateAlertThreshold({
        key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
        thresholdCount: 0,
        actorUserId: "admin-1",
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", statusCode: 400 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates the row, invalidates the cache, and logs an audit event", async () => {
    mockFindUnique.mockResolvedValue({
      id: "row-1",
      key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: true,
    });
    mockUpdate.mockResolvedValue({
      id: "row-1",
      key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
      thresholdCount: 10,
      windowMinutes: 15,
      enabled: true,
    });

    const result = await updateAlertThreshold({
      key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE,
      thresholdCount: 10,
      actorUserId: "admin-1",
    });

    expect(result.thresholdCount).toBe(10);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { key: ALERT_THRESHOLD_KEYS.AI_JOB_FAILURE },
      data: { thresholdCount: 10, updatedByUserId: "admin-1" },
    });
    expect(mockLogAuditEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "MANUAL_CHANGE",
        action: "ALERT_THRESHOLD_UPDATED",
        actorUserId: "admin-1",
        resourceId: "row-1",
      })
    );
  });
});

describe("AlertThresholdError", () => {
  it("carries the status code and error code", () => {
    const error = new AlertThresholdError("bad input", 400, "INVALID_INPUT");
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toBe("bad input");
  });
});
