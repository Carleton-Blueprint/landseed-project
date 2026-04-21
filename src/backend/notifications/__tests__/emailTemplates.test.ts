import { NotificationEventType } from "@prisma/client";
import { renderEmailTemplate } from "@/backend/notifications/emailTemplates";

describe("renderEmailTemplate", () => {
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
});