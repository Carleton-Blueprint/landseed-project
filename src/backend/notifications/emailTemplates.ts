import { NotificationEventType } from "@prisma/client";

type TemplateInput = {
  eventType: NotificationEventType;
  recipientName?: string | null;
  projectAddress?: string | null;
  estimateLink?: string | null;
  estimateMin?: number;
  estimateMax?: number;
};

export type RenderedEmailTemplate = {
  templateName: string;
  subject: string;
  html: string;
  text: string;
};

function safeName(name?: string | null): string {
  return name?.trim() || "there";
}

export function renderEmailTemplate(input: TemplateInput): RenderedEmailTemplate {
  if (input.eventType === NotificationEventType.SUBMISSION_RECEIPT) {
    const recipientName = safeName(input.recipientName);
    const addressLine = input.projectAddress ? ` for ${input.projectAddress}` : "";

    return {
      templateName: "submission-receipt-v1",
      subject: "We received your Landseed submission",
      html: `<p>Hi ${recipientName},</p><p>Thanks for your submission${addressLine}. Our team has received it and will review it shortly.</p><p>We will notify you when your estimate is ready.</p><p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nThanks for your submission${addressLine}. Our team has received it and will review it shortly.\n\nWe will notify you when your estimate is ready.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.ESTIMATE_READY) {
    const recipientName = safeName(input.recipientName);
    const estimateLink = input.estimateLink?.trim();
    const addressLine = input.projectAddress ? ` for ${input.projectAddress}` : "";
    const subjectAddressSuffix = input.projectAddress ? ` for ${input.projectAddress}` : "";
    const linkHtml = estimateLink
      ? `<p><a href="${estimateLink}">View your estimate</a></p>`
      : "";
    const linkText = estimateLink
      ? `\nView your estimate: ${estimateLink}\n`
      : "\nYour advisory specialist will provide your estimate link shortly.\n";
    const rangeHtml =
      input.estimateMin != null && input.estimateMax != null
        ? `<p><strong>Estimated range:</strong> $${input.estimateMin.toFixed(2)} - $${input.estimateMax.toFixed(2)}</p>`
        : "";
    const rangeText =
      input.estimateMin != null && input.estimateMax != null
        ? `\nEstimated range: $${input.estimateMin.toFixed(2)} - $${input.estimateMax.toFixed(2)}\n`
        : "";

    return {
      templateName: "estimate-ready-v1",
      subject: `Your Landseed estimate${subjectAddressSuffix} is ready`,
      html: `<p>Hi ${recipientName},</p><p>Your estimate${addressLine} is now ready for review.</p>${rangeHtml}<p>Your advisory specialist has completed preparation and the next step is to review the estimate details.</p>${linkHtml}<p>If you have questions, reply to this email and our team can help.</p><p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nYour estimate${addressLine} is now ready for review.\n${rangeText}\nYour advisory specialist has completed preparation and the next step is to review the estimate details.${linkText}\nIf you have questions, reply to this email and our team can help.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.ESTIMATE_EXPIRED) {
    const recipientName = safeName(input.recipientName);
    const addressLine = input.projectAddress ? ` for ${input.projectAddress}` : "";

    return {
      templateName: "estimate-expired-v1",
      subject: "Your Landseed estimate has expired",
      html: `<p>Hi ${recipientName},</p><p>Your estimate${addressLine} has expired after 30 days of inactivity.</p><p>You can reactivate it from your dashboard at any time.</p><p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nYour estimate${addressLine} has expired after 30 days of inactivity.\n\nYou can reactivate it from your dashboard at any time.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.ESTIMATE_REACTIVATED) {
    const recipientName = safeName(input.recipientName);
    const estimateLink = input.estimateLink?.trim();
    const addressLine = input.projectAddress ? ` for ${input.projectAddress}` : "";
    const linkHtml = estimateLink
      ? `<p><a href="${estimateLink}">Open your estimate</a></p>`
      : "";
    const linkText = estimateLink ? `\nOpen your estimate: ${estimateLink}\n` : "";

    return {
      templateName: "estimate-reactivated-v1",
      subject: "Your Landseed estimate is active again",
      html: `<p>Hi ${recipientName},</p><p>Your estimate${addressLine} has been reactivated and is ready for review.</p>${linkHtml}<p>Landseed Team</p>`,
      text: `Hi ${recipientName},\n\nYour estimate${addressLine} has been reactivated and is ready for review.${linkText}\nLandseed Team`,
    };
  }

  throw new Error(`Unsupported event type: ${input.eventType}`);
}
