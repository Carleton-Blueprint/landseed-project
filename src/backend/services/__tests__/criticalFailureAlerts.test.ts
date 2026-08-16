/**
 * @jest-environment node
 */
import { incrementFailureCounter } from "@/backend/monitoring/failureWindow";
import { getAlertThreshold } from "@/backend/services/alertThresholds";
import { sendAdminAlert } from "@/backend/services/adminAlerts";
import { recordFailureAndMaybeAlert } from "../criticalFailureAlerts";

jest.mock("@/backend/monitoring/failureWindow", () => ({
  incrementFailureCounter: jest.fn(),
}));

jest.mock("@/backend/services/alertThresholds", () => ({
  getAlertThreshold: jest.fn(),
  ALERT_THRESHOLD_KEYS: {
    AI_JOB_FAILURE: "ai-job-failure",
    BUILDERTREND_TRANSFER_FAILURE: "buildertrend-transfer-failure",
    EMAIL_DELIVERY_FAILURE: "email-delivery-failure",
    FILE_SCAN_FAILURE: "file-scan-failure",
  },
}));

jest.mock("@/backend/services/adminAlerts", () => ({
  sendAdminAlert: jest.fn(),
}));

describe("recordFailureAndMaybeAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("no-ops when the threshold key is unrecognized", async () => {
    (getAlertThreshold as jest.Mock).mockResolvedValue(null);

    await recordFailureAndMaybeAlert({ key: "ai-job-failure", summary: "x" });

    expect(incrementFailureCounter).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("no-ops when the threshold is disabled", async () => {
    (getAlertThreshold as jest.Mock).mockResolvedValue({
      key: "ai-job-failure",
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: false,
    });

    await recordFailureAndMaybeAlert({ key: "ai-job-failure", summary: "x" });

    expect(incrementFailureCounter).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("does not alert while under the threshold", async () => {
    (getAlertThreshold as jest.Mock).mockResolvedValue({
      key: "ai-job-failure",
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: true,
    });
    (incrementFailureCounter as jest.Mock).mockResolvedValue(3);

    await recordFailureAndMaybeAlert({ key: "ai-job-failure", summary: "x" });

    expect(incrementFailureCounter).toHaveBeenCalledWith("alert-failure:ai-job-failure", 15 * 60);
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("alerts exactly once, the moment the count reaches the threshold", async () => {
    (getAlertThreshold as jest.Mock).mockResolvedValue({
      key: "ai-job-failure",
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: true,
    });
    (incrementFailureCounter as jest.Mock).mockResolvedValue(5);

    await recordFailureAndMaybeAlert({
      key: "ai-job-failure",
      summary: "AI job failed",
      details: { jobId: "job-1" },
    });

    expect(sendAdminAlert).toHaveBeenCalledWith({
      category: "ai-job-failure",
      summary: "AI job failed",
      details: { jobId: "job-1", failureCount: 5, windowMinutes: 15 },
    });
  });

  it("does not re-alert for failures after the threshold within the same window", async () => {
    (getAlertThreshold as jest.Mock).mockResolvedValue({
      key: "ai-job-failure",
      thresholdCount: 5,
      windowMinutes: 15,
      enabled: true,
    });
    (incrementFailureCounter as jest.Mock).mockResolvedValue(6);

    await recordFailureAndMaybeAlert({ key: "ai-job-failure", summary: "x" });

    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("swallows errors instead of throwing", async () => {
    (getAlertThreshold as jest.Mock).mockRejectedValue(new Error("db down"));

    await expect(
      recordFailureAndMaybeAlert({ key: "ai-job-failure", summary: "x" })
    ).resolves.toBeUndefined();
  });
});
