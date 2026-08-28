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

  it("renders estimate updated template with the previous and new total", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_UPDATED,
      recipientName: "Alex",
      projectAddress: "100 Main St",
      estimateLink: "https://example.com/projects/p-1/estimate",
      previousTotal: 1200,
      newTotal: 1450,
    });

    expect(template.templateName).toBe("estimate-updated-v1");
    expect(template.subject).toBe("Your Landseed estimate for 100 Main St has been updated");
    expect(template.html).toContain("Hi Alex");
    expect(template.html).toContain("$1200.00");
    expect(template.html).toContain("$1450.00");
    expect(template.html).toContain("View your updated estimate");
    expect(template.text).toContain("changed from $1200.00 to $1450.00");
  });

  it("renders a generic estimate updated message when no totals are provided", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_UPDATED,
      recipientName: "Alex",
    });

    expect(template.html).toContain("has been updated");
    expect(template.html).not.toContain("$");
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

  it("renders the manual review flag created template with reason, description, and link", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.MANUAL_REVIEW_FLAG_CREATED,
      projectAddress: "100 Main St",
      estimateLink: "https://example.com/admin/flagged-projects",
      manualReviewReason: "HIGH_COMPLEXITY",
      manualReviewDescription: "Project complexity is HIGH (3 signals detected)",
    });

    expect(template.templateName).toBe("manual-review-flag-created-v1");
    expect(template.subject).toBe("[Action Needed] Project Flagged for Manual Review — 100 Main St");
    expect(template.html).toContain("100 Main St");
    expect(template.html).toContain("high complexity");
    expect(template.html).toContain("Project complexity is HIGH (3 signals detected)");
    expect(template.html).toContain("https://example.com/admin/flagged-projects");
    expect(template.text).toContain("Reason: high complexity");
  });

  it("renders the manual review flag created template without an address or description", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.MANUAL_REVIEW_FLAG_CREATED,
      estimateLink: "https://example.com/admin/flagged-projects",
      manualReviewReason: "LOW_CONFIDENCE",
    });

    expect(template.subject).toBe("[Action Needed] Project Flagged for Manual Review");
    expect(template.html).toContain("low confidence");
  });

});
