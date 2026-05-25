import { CommunicationCategory, NotificationEventType, CommunicationStatus } from "@prisma/client";
import { NotificationJobPayload } from "@/backend/notifications/service";

export interface EmailTemplate {
  subject: string;
  templateName: string;
  html: string;
  text: string;
}

/**
 * Maps NotificationEventType to CommunicationCategory
 */
export function getCategoryFromEventType(eventType: NotificationEventType): CommunicationCategory {
  switch (eventType) {
    case NotificationEventType.SUBMISSION_RECEIPT:
      return CommunicationCategory.SUBMISSION_RECEIPT;
    case NotificationEventType.ESTIMATE_READY:
    case NotificationEventType.ESTIMATE_EXPIRED:
    case NotificationEventType.ESTIMATE_REACTIVATED:
      return CommunicationCategory.ESTIMATE;
    case NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM:
      return CommunicationCategory.QUESTION;
    case NotificationEventType.FILE_MALWARE_DETECTED:
      return CommunicationCategory.DOCUMENT;
    case NotificationEventType.MANUAL_FALLBACK_EXPORT_READY:
      return CommunicationCategory.DOCUMENT;
    default:
      return CommunicationCategory.OTHER;
  }
}

/**
 * Generates a content summary from notification payload and template
 */
export function generateContentSummary(
  payload: NotificationJobPayload,
  template: EmailTemplate
): string {
  const lines: string[] = [];

  lines.push(`Subject: ${template.subject}`);
  lines.push(`Event Type: ${payload.eventType}`);

  if (payload.projectAddress) {
    lines.push(`Project Address: ${payload.projectAddress}`);
  }

  if (payload.recipientName) {
    lines.push(`Recipient: ${payload.recipientName}`);
  }

  if (payload.estimateMin && payload.estimateMax) {
    lines.push(`Estimate Range: $${payload.estimateMin} - $${payload.estimateMax}`);
  }

  if (payload.questionCategory) {
    lines.push(`Question Category: ${payload.questionCategory}`);
  }

  if (payload.questionSubject) {
    lines.push(`Question: ${payload.questionSubject}`);
  }

  if (payload.fileName) {
    lines.push(`File: ${payload.fileName}`);
  }

  return lines.join("\n");
}

/**
 * Determines linked resource type based on event type
 */
export function getLinkedResourceType(eventType: NotificationEventType): string | undefined {
  switch (eventType) {
    case NotificationEventType.ESTIMATE_READY:
    case NotificationEventType.ESTIMATE_EXPIRED:
    case NotificationEventType.ESTIMATE_REACTIVATED:
      return "Quote";
    case NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM:
      return "QuoteQuestion";
    case NotificationEventType.FILE_MALWARE_DETECTED:
      return "Document";
    default:
      return undefined;
  }
}

export interface AccountDeletionCommunicationContext {
  targetUserName?: string | null;
  targetUserEmail: string;
  requestId: string;
  noticeType: "ADVANCE_NOTICE" | "FINAL_NOTICE";
  gracePeriodEndsAt: Date;
  requestedAt: Date;
}

export function getAccountDeletionCommunicationCategory(): CommunicationCategory {
  return CommunicationCategory.SYSTEM_ALERT;
}

export function buildAccountDeletionContentSummary(
  context: AccountDeletionCommunicationContext
): string {
  const lines = [
    "Subject: Account deletion notice",
    `Notice Type: ${context.noticeType}`,
    `Request ID: ${context.requestId}`,
    `Target Email: ${context.targetUserEmail}`,
    `Requested At: ${context.requestedAt.toISOString()}`,
    `Deletion Scheduled For: ${context.gracePeriodEndsAt.toISOString()}`,
  ];

  if (context.targetUserName) {
    lines.push(`Target User: ${context.targetUserName}`);
  }

  return lines.join("\n");
}

/**
 * Maps delivery status to communication status
 */
export function mapDeliveryStatus(attempts: number, error: string | null | undefined): CommunicationStatus {
  if (error) {
    return CommunicationStatus.FAILED;
  }
  return CommunicationStatus.SENT;
}
