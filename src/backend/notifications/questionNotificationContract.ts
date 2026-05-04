import { NotificationEventType } from "@prisma/client";
import { enqueueNotification } from "@/backend/notifications/enqueue";
import type { NotificationJobPayload } from "@/backend/notifications/service";

export interface QuestionSubmittedNotificationPayload {
  quoteId: string;
  projectId: string;
  projectAddress: string;
  questionCategory: string;
  questionSubject: string;
  questionId: string;
  clientName?: string | null;
  clientEmail?: string | null;
  advisoryTeamEmails: string[];
}

export function buildQuestionNotificationIdempotencyKey(questionId: string): string {
  return `question-submitted:${questionId}`;
}

export async function enqueueQuestionNotificationForAdvisoryTeam(
  payload: QuestionSubmittedNotificationPayload
): Promise<void> {
  const adminDashboardUrl = 
    process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const estimateLink = `${adminDashboardUrl}/admin`;

  // Send to each advisory team member
  for (const teamEmail of payload.advisoryTeamEmails) {
    const jobPayload: NotificationJobPayload = {
      eventType: NotificationEventType.QUESTION_SUBMITTED_FOR_ADVISORY_TEAM,
      idempotencyKey: `${buildQuestionNotificationIdempotencyKey(payload.questionId)}:${teamEmail}`,
      recipientEmail: teamEmail,
      recipientName: "Advisory Team Member",
      projectId: payload.projectId,
      projectAddress: payload.projectAddress,
      estimateLink,
      questionCategory: payload.questionCategory,
      questionSubject: payload.questionSubject,
    };

    await enqueueNotification(jobPayload);
  }
}
