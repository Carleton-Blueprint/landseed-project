/**
 * Admin/advisory-authored custom email to a project's client.
 * Must only be reachable via /api/admin/projects/{projectId}/messages.
 */

import { CommunicationStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logCommunication } from "@/backend/services/communicationHistoryLogger";
import { logAuditEventNonBlocking } from "@/backend/audit/log";

export const ADMIN_CUSTOM_EMAIL_MAX_SUBJECT_LENGTH = 200;
export const ADMIN_CUSTOM_EMAIL_MAX_MESSAGE_LENGTH = 10_000;
const CONTENT_SUMMARY_PREVIEW_LENGTH = 280;

type AdminCustomEmailErrorCode =
  | "PROJECT_NOT_FOUND"
  | "RECIPIENT_NOT_FOUND"
  | "RECIPIENT_NOT_ON_PROJECT"
  | "RECIPIENT_HAS_NO_EMAIL"
  | "INVALID_SUBJECT"
  | "INVALID_MESSAGE";

export class AdminCustomEmailError extends Error {
  statusCode: number;
  code: AdminCustomEmailErrorCode;

  constructor(message: string, statusCode: number, code: AdminCustomEmailErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SendAdminCustomEmailInput {
  projectId: string;
  recipientId: unknown;
  subject: unknown;
  message: unknown;
  senderId: string;
}

export interface SendAdminCustomEmailResult {
  communicationId: string;
  delivered: boolean;
  provider?: string;
  messageId?: string;
  deliveryError?: string;
}

function normalizeSubject(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminCustomEmailError("Subject must be a string", 400, "INVALID_SUBJECT");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new AdminCustomEmailError("Subject is required", 400, "INVALID_SUBJECT");
  }

  if (normalized.length > ADMIN_CUSTOM_EMAIL_MAX_SUBJECT_LENGTH) {
    throw new AdminCustomEmailError(
      `Subject must be at most ${ADMIN_CUSTOM_EMAIL_MAX_SUBJECT_LENGTH} characters`,
      400,
      "INVALID_SUBJECT"
    );
  }

  return normalized;
}

function normalizeMessage(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminCustomEmailError("Message is required", 400, "INVALID_MESSAGE");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new AdminCustomEmailError("Message is required", 400, "INVALID_MESSAGE");
  }

  if (normalized.length > ADMIN_CUSTOM_EMAIL_MAX_MESSAGE_LENGTH) {
    throw new AdminCustomEmailError(
      `Message must be at most ${ADMIN_CUSTOM_EMAIL_MAX_MESSAGE_LENGTH} characters`,
      400,
      "INVALID_MESSAGE"
    );
  }

  return normalized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmailBody(message: string): { html: string; text: string } {
  const paragraphs = message
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return { html: paragraphs, text: message };
}

function buildContentSummary(subject: string, message: string): string {
  const preview =
    message.length > CONTENT_SUMMARY_PREVIEW_LENGTH
      ? `${message.slice(0, CONTENT_SUMMARY_PREVIEW_LENGTH)}…`
      : message;

  return `Subject: ${subject}\n${preview}`;
}

async function resolveRecipient(projectId: string, recipientId: unknown) {
  if (typeof recipientId !== "string" || !recipientId.trim()) {
    throw new AdminCustomEmailError("recipientId is required", 400, "RECIPIENT_NOT_FOUND");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  });

  if (!project) {
    throw new AdminCustomEmailError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, name: true, email: true },
  });

  if (!recipient) {
    throw new AdminCustomEmailError("Recipient not found", 404, "RECIPIENT_NOT_FOUND");
  }

  if (recipient.id !== project.userId) {
    const access = await prisma.projectAccess.findUnique({
      where: { projectId_userId: { projectId, userId: recipient.id } },
      select: { id: true },
    });

    if (!access) {
      throw new AdminCustomEmailError(
        "Recipient does not have access to this project",
        400,
        "RECIPIENT_NOT_ON_PROJECT"
      );
    }
  }

  if (!recipient.email) {
    throw new AdminCustomEmailError("Recipient has no email on file", 400, "RECIPIENT_HAS_NO_EMAIL");
  }

  return recipient as { id: string; name: string | null; email: string };
}

/**
 * Sends an admin/advisory-authored custom email to a project participant and
 * records the attempt in the project's communication history, regardless of
 * whether the send succeeds. Delivery failures are returned, not thrown, so
 * callers can distinguish "your request was invalid" (thrown) from
 * "the request was valid but the email provider failed" (returned).
 */
export async function sendAdminCustomEmail(
  input: SendAdminCustomEmailInput
): Promise<SendAdminCustomEmailResult> {
  const subject = normalizeSubject(input.subject);
  const message = normalizeMessage(input.message);
  const recipient = await resolveRecipient(input.projectId, input.recipientId);

  const { html, text } = renderEmailBody(message);
  const contentSummary = buildContentSummary(subject, message);

  try {
    const result = await sendTransactionalEmail({
      to: recipient.email,
      subject,
      html,
      text,
    });

    const communicationId = await logCommunication({
      projectId: input.projectId,
      communicationType: "EMAIL",
      category: "OTHER",
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      senderId: input.senderId,
      subject,
      contentSummary,
      status: CommunicationStatus.SENT,
      metadata: {
        provider: result.provider,
        messageId: result.messageId,
        source: "admin_custom_email",
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ADMIN_CUSTOM_EMAIL_SENT",
      outcome: "SUCCESS",
      resourceType: "CommunicationHistory",
      resourceId: communicationId,
      projectId: input.projectId,
      actorUserId: input.senderId,
      description: `Admin custom email sent to ${recipient.email}`,
      metadata: { subject, recipientId: recipient.id, provider: result.provider },
    });

    return {
      communicationId,
      delivered: true,
      provider: result.provider,
      messageId: result.messageId,
    };
  } catch (error) {
    const deliveryError = error instanceof Error ? error.message : "Unknown email delivery error";

    const communicationId = await logCommunication({
      projectId: input.projectId,
      communicationType: "EMAIL",
      category: "OTHER",
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      senderId: input.senderId,
      subject,
      contentSummary,
      status: CommunicationStatus.FAILED,
      metadata: {
        error: deliveryError,
        source: "admin_custom_email",
      },
    });

    await logAuditEventNonBlocking({
      category: "MANUAL_CHANGE",
      action: "ADMIN_CUSTOM_EMAIL_SENT",
      outcome: "FAILURE",
      resourceType: "CommunicationHistory",
      resourceId: communicationId,
      projectId: input.projectId,
      actorUserId: input.senderId,
      reason: deliveryError,
      description: `Admin custom email to ${recipient.email} failed to send`,
      metadata: { subject, recipientId: recipient.id },
    });

    return {
      communicationId,
      delivered: false,
      deliveryError,
    };
  }
}
