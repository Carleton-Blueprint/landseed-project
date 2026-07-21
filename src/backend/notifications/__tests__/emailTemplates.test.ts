import { NotificationEventType } from "@prisma/client";
import { renderEmailTemplate } from "@/backend/notifications/emailTemplates";

describe("renderEmailTemplate", () => {
  it("renders estimate ready template with address, link, and estimate range", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_READY,
      recipientName: "Alex",
      projectAddress: "100 Main St",
      estimateLink: "https://example.com/projects/p-1/estimate",
      estimateMin: 4500,
      estimateMax: 5200,
    });

    expect(template.templateName).toBe("estimate-ready-v1");
    expect(template.subject).toBe("Your Landseed estimate for 100 Main St is ready");
    expect(template.html).toContain("Hi Alex");
    expect(template.html).toContain("for 100 Main St");
    expect(template.html).toContain("Estimated range");
    expect(template.html).toContain("View your estimate");
    expect(template.text).toContain("https://example.com/projects/p-1/estimate");
    expect(template.text).toContain("Estimated range: $4500.00 - $5200.00");
  });

  it("renders estimate ready template without link when unavailable", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_READY,
      recipientName: "Alex",
    });

    expect(template.subject).toBe("Your Landseed estimate is ready");
    expect(template.html).toContain("Hi Alex");
    expect(template.html).not.toContain("View your estimate");
    expect(template.text).not.toContain("View your estimate:");
  });

  it("renders estimate expired template", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_EXPIRED,
      recipientName: "Alex",
      projectAddress: "123 Main St",
    });

    expect(template.templateName).toBe("estimate-expired-v1");
    expect(template.subject).toContain("expired");
    expect(template.html).toContain("123 Main St");
    expect(template.text).toContain("30 days");
  });

  it("renders estimate reactivated template with link", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_REACTIVATED,
      recipientName: "Casey",
      projectAddress: "456 Oak Ave",
      estimateLink: "https://example.test/projects/p1/estimate",
    });

    expect(template.templateName).toBe("estimate-reactivated-v1");
    expect(template.subject).toContain("active again");
    expect(template.html).toContain("https://example.test/projects/p1/estimate");
    expect(template.text).toContain("Open your estimate");
  });

  it("renders email verification template for caregiver submissions", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.EMAIL_VERIFICATION,
      recipientName: "Alex",
      seniorName: "Pat Senior",
      isCaregiverSubmission: true,
      authActionLink: "https://example.test/api/auth/verify-email?token=abc",
    });

    expect(template.templateName).toBe("email-verification-v1");
    expect(template.subject).toBe("Confirm your Landseed email");
    expect(template.html).toContain("Pat Senior");
    expect(template.html).toContain("Confirm your email");
    expect(template.text).toContain("https://example.test/api/auth/verify-email?token=abc");
  });

  it("renders password reset template with reset link", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.PASSWORD_RESET,
      recipientName: "Alex",
      authActionLink: "https://example.test/auth/reset-password?token=abc",
    });

    expect(template.templateName).toBe("password-reset-v1");
    expect(template.subject).toBe("Reset your Landseed password");
    expect(template.html).toContain("Reset your password");
    expect(template.text).toContain("https://example.test/auth/reset-password?token=abc");
  });

  it("renders the email-change verify-old template with the pending new address and 1-hour expiry", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.EMAIL_CHANGE_VERIFY_OLD,
      recipientName: "Alex",
      newEmail: "alex-new@example.com",
      authActionLink: "https://example.test/api/account/email-change/verify-old?token=abc",
    });

    expect(template.templateName).toBe("email-change-verify-old-v1");
    expect(template.subject).toBe("Confirm your Landseed email change");
    expect(template.html).toContain("alex-new@example.com");
    expect(template.html).toContain("expires in 1 hour");
    expect(template.text).toContain("https://example.test/api/account/email-change/verify-old?token=abc");
  });

  it("renders the email-change verify-new template with 1-hour expiry", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.EMAIL_CHANGE_VERIFY_NEW,
      recipientName: "Alex",
      authActionLink: "https://example.test/api/account/email-change/verify-new?token=abc",
    });

    expect(template.templateName).toBe("email-change-verify-new-v1");
    expect(template.subject).toBe("Confirm your new Landseed email address");
    expect(template.html).toContain("Confirm new email");
    expect(template.html).toContain("expires in 1 hour");
    expect(template.text).toContain("https://example.test/api/account/email-change/verify-new?token=abc");
  });

});
