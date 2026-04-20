import { NotificationEventType } from "@prisma/client";
import { renderEmailTemplate } from "../emailTemplates";

describe("renderEmailTemplate", () => {
  it("personalizes estimate-ready template with address and link", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_READY,
      recipientName: "Alex",
      projectAddress: "100 Main St",
      estimateLink: "https://example.com/projects/p-1/estimate",
    });

    expect(template.templateName).toBe("estimate-ready-v1");
    expect(template.subject).toBe("Your Landseed estimate for 100 Main St is ready");
    expect(template.html).toContain("Hi Alex");
    expect(template.html).toContain("View your estimate");
    expect(template.text).toContain("https://example.com/projects/p-1/estimate");
  });

  it("includes fallback guidance when estimate link is unavailable", () => {
    const template = renderEmailTemplate({
      eventType: NotificationEventType.ESTIMATE_READY,
      recipientName: "Alex",
    });

    expect(template.subject).toBe("Your Landseed estimate is ready");
    expect(template.text).toContain("advisory specialist will provide your estimate link shortly");
  });
});
