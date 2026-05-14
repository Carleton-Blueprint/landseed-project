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

  it("renders manual fallback export ready template", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.MANUAL_FALLBACK_EXPORT_READY,
      recipientName: "Jordan",
      projectAddress: "789 Pine Rd",
      manualFallbackExportLink: "https://example.test/api/project/p1/manual-fallback-export/export-1/download",
      manualFallbackExportRetentionDays: 7,
    });

    expect(template.templateName).toBe("manual-fallback-export-ready-v1");
    expect(template.subject).toContain("fallback export");
    expect(template.html).toContain("Download the fallback export");
    expect(template.html).toContain("789 Pine Rd");
    expect(template.text).toContain("Download the fallback export");
    expect(template.text).toContain("7 days");
  });
});
