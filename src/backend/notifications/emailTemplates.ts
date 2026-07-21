import { NotificationEventType } from "@prisma/client";

type TemplateInput = {
  eventType: NotificationEventType;
  recipientName?: string | null;
  projectAddress?: string | null;
  estimateLink?: string | null;
  estimateMin?: number;
  estimateMax?: number;
  questionCategory?: string;   
  questionSubject?: string;
  fileName?: string;
  documentType?: string;
  authActionLink?: string | null;
  seniorName?: string | null;
  isCaregiverSubmission?: boolean;
  newEmail?: string | null;
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

function authActionButton(link: string, label: string): string {
  return `<p><a href="${link}" style="display:inline-block;padding:14px 24px;font-size:18px;font-weight:600;text-decoration:none;border-radius:6px;background:#1f4d3a;color:#ffffff;">${label}</a></p>`;
}

function authSupportFooter(): string {
  return `<p style="font-size:16px;color:#444;">If you need help, reply to this email or contact the Landseed advisory team.</p><p>Landseed Team</p>`;
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

  if (input.eventType === NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM) {
    return {
      templateName: "question-submitted-advisory-v1",
      subject: `[Advisory] New Question on Estimate for ${input.projectAddress || "Project"}`,
      html: `
        <p>Hi Advisory Team,</p>
        <p>A client has submitted a new question about their estimate for <strong>${input.projectAddress || "their project"}</strong>.</p>
        <p><strong>Details:</strong></p>
        <ul>
          <li>Category: ${input.questionCategory || "General"}</li>
          <li>Subject: ${input.questionSubject || "N/A"}</li>
          <li>Time: ${new Date().toLocaleString()}</li>
        </ul>
        <p><a href="${input.estimateLink}">Review in Admin Dashboard</a></p>
        <p>Landseed Team</p>
      `,
      text: `Hi Advisory Team,\n\nA client has submitted a new question about their estimate for ${input.projectAddress || "their project"}.\n\nCategory: ${input.questionCategory || "General"}\nSubject: ${input.questionSubject || "N/A"}\n\nReview in Admin Dashboard: ${input.estimateLink}\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.FILE_MALWARE_DETECTED) {
    const recipientName = safeName(input.recipientName);
    const fileName = input.fileName || "Your file";
    const documentTypeInfo = input.documentType ? ` (${input.documentType})` : "";
    const addressLine = input.projectAddress ? ` for ${input.projectAddress}` : "";

    return {
      templateName: "file-malware-detected-v1",
      subject: "Security Alert: Infected File Rejected",
      html: `
        <p>Hi ${recipientName},</p>
        <p><strong>Security Alert:</strong> We detected malware in a file you attempted to upload${addressLine}.</p>
        <p><strong>File:</strong> ${fileName}${documentTypeInfo}</p>
        <p>For your security, this file has been automatically deleted and cannot be used for your application.</p>
        <h3>What to do:</h3>
        <ul>
          <li>Scan the file on your computer with updated antivirus software</li>
          <li>If the file is clean, re-upload it</li>
          <li>Contact IT support if you believe this is a false positive</li>
        </ul>
        <p>If you have questions, please contact our support team.</p>
        <p>Landseed Team</p>
      `,
      text: `Hi ${recipientName},\n\nSecurity Alert: We detected malware in a file you attempted to upload${addressLine}.\n\nFile: ${fileName}${documentTypeInfo}\n\nFor your security, this file has been automatically deleted and cannot be used for your application.\n\nWhat to do:\n- Scan the file on your computer with updated antivirus software\n- If the file is clean, re-upload it\n- Contact IT support if you believe this is a false positive\n\nIf you have questions, please contact our support team.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.EMAIL_VERIFICATION) {
    const recipientName = safeName(input.recipientName);
    const actionLink = input.authActionLink?.trim();
    const seniorName = input.seniorName?.trim();
    const isCaregiver = Boolean(input.isCaregiverSubmission && seniorName);

    const introHtml = isCaregiver
      ? `<p>Hi ${recipientName},</p><p>Please confirm this email address for <strong>${seniorName}</strong>'s Landseed home modification account.</p>`
      : `<p>Hi ${recipientName},</p><p>Please confirm your email address to secure your Landseed account.</p>`;
    const introText = isCaregiver
      ? `Hi ${recipientName},\n\nPlease confirm this email address for ${seniorName}'s Landseed home modification account.`
      : `Hi ${recipientName},\n\nPlease confirm your email address to secure your Landseed account.`;

    const linkHtml = actionLink ? authActionButton(actionLink, "Confirm your email") : "";
    const linkText = actionLink ? `\nConfirm your email: ${actionLink}\n` : "";

    return {
      templateName: "email-verification-v1",
      subject: "Confirm your Landseed email",
      html: `${introHtml}<p>This link expires in 24 hours.</p>${linkHtml}${authSupportFooter()}`,
      text: `${introText}\n\nThis link expires in 24 hours.${linkText}\nIf you need help, reply to this email or contact the Landseed advisory team.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.PASSWORD_RESET) {
    const recipientName = safeName(input.recipientName);
    const actionLink = input.authActionLink?.trim();
    const linkHtml = actionLink ? authActionButton(actionLink, "Reset your password") : "";
    const linkText = actionLink ? `\nReset your password: ${actionLink}\n` : "";

    return {
      templateName: "password-reset-v1",
      subject: "Reset your Landseed password",
      html: `<p>Hi ${recipientName},</p><p>We received a request to reset your Landseed password.</p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>${linkHtml}${authSupportFooter()}`,
      text: `Hi ${recipientName},\n\nWe received a request to reset your Landseed password.\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.${linkText}\nIf you need help, reply to this email or contact the Landseed advisory team.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.EMAIL_CHANGE_VERIFY_OLD) {
    const recipientName = safeName(input.recipientName);
    const actionLink = input.authActionLink?.trim();
    const newEmail = input.newEmail?.trim();
    const newEmailLine = newEmail ? ` to <strong>${newEmail}</strong>` : "";
    const newEmailTextLine = newEmail ? ` to ${newEmail}` : "";
    const linkHtml = actionLink ? authActionButton(actionLink, "Confirm email change") : "";
    const linkText = actionLink ? `\nConfirm email change: ${actionLink}\n` : "";

    return {
      templateName: "email-change-verify-old-v1",
      subject: "Confirm your Landseed email change",
      html: `<p>Hi ${recipientName},</p><p>We received a request to change the email on your Landseed account${newEmailLine}.</p><p>This link expires in 1 hour. If you did not request this, you can ignore this email and your address will not change.</p>${linkHtml}${authSupportFooter()}`,
      text: `Hi ${recipientName},\n\nWe received a request to change the email on your Landseed account${newEmailTextLine}.\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email and your address will not change.${linkText}\nIf you need help, reply to this email or contact the Landseed advisory team.\n\nLandseed Team`,
    };
  }

  if (input.eventType === NotificationEventType.EMAIL_CHANGE_VERIFY_NEW) {
    const recipientName = safeName(input.recipientName);
    const actionLink = input.authActionLink?.trim();
    const linkHtml = actionLink ? authActionButton(actionLink, "Confirm new email") : "";
    const linkText = actionLink ? `\nConfirm new email: ${actionLink}\n` : "";

    return {
      templateName: "email-change-verify-new-v1",
      subject: "Confirm your new Landseed email address",
      html: `<p>Hi ${recipientName},</p><p>Please confirm this address as the new login email for your Landseed account.</p><p>This link expires in 1 hour. If you did not request this, you can ignore this email and your address will not change.</p>${linkHtml}${authSupportFooter()}`,
      text: `Hi ${recipientName},\n\nPlease confirm this address as the new login email for your Landseed account.\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email and your address will not change.${linkText}\nIf you need help, reply to this email or contact the Landseed advisory team.\n\nLandseed Team`,
    };
  }

  throw new Error(`Unsupported event type: ${input.eventType}`);
}
