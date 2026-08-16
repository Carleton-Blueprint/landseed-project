/**
 * @jest-environment node
 */
import { parseAllowedEmails } from "@/backend/auth/requireRole";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";
import { sendAdminAlert } from "../adminAlerts";

jest.mock("@/backend/auth/requireRole", () => ({
  parseAllowedEmails: jest.fn(),
}));

jest.mock("@/backend/services/transactionalEmail", () => ({
  sendTransactionalEmail: jest.fn(),
}));

jest.mock("@/backend/security/securityEvent", () => ({
  logSecurityEventNonBlocking: jest.fn(),
}));

describe("sendAdminAlert", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emails every allowlisted admin and logs a SecurityEvent", async () => {
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test", "b@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockResolvedValue({ provider: "resend" });

    await sendAdminAlert({
      category: "ai-job-failure",
      summary: "AI job failed after 3 attempts",
      details: { jobId: "job-1" },
    });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@landseed.test", subject: expect.stringContaining("AI job failed") })
    );
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "b@landseed.test" })
    );
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith({
      eventType: "ALERT_TRIGGERED",
      scope: "ai-job-failure",
      identifier: "admin-alert",
      route: null,
      metadata: {
        summary: "AI job failed after 3 attempts",
        details: { jobId: "job-1" },
        recipientCount: 2,
      },
    });
  });

  it("logs but does not throw when no admins are configured", async () => {
    (parseAllowedEmails as jest.Mock).mockReturnValue([]);

    await expect(
      sendAdminAlert({ category: "email-delivery-failure", summary: "test" })
    ).resolves.toBeUndefined();

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(logSecurityEventNonBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ recipientCount: 0 }) })
    );
  });

  it("does not throw when an individual send fails", async () => {
    (parseAllowedEmails as jest.Mock).mockReturnValue(["a@landseed.test"]);
    (sendTransactionalEmail as jest.Mock).mockRejectedValue(new Error("resend down"));

    await expect(
      sendAdminAlert({ category: "file-scan-failure", summary: "test" })
    ).resolves.toBeUndefined();

    expect(logSecurityEventNonBlocking).toHaveBeenCalled();
  });
});
