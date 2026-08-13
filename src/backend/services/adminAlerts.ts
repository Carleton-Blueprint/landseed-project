import { parseAllowedEmails } from "@/backend/auth/requireRole";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";
import { logSecurityEventNonBlocking } from "@/backend/security/securityEvent";

export interface AdminAlertInput {
  /** Alert-threshold key this alert is for, e.g. "ai-job-failure". */
  category: string;
  summary: string;
  details?: Record<string, unknown>;
}

function renderAlertEmail(input: AdminAlertInput): { subject: string; html: string; text: string } {
  const detailsJson = JSON.stringify(input.details ?? {}, null, 2);
  return {
    subject: `[LandSeed Alert] ${input.summary}`,
    html: `<p>${input.summary}</p><pre>${detailsJson}</pre>`,
    text: `${input.summary}\n\n${detailsJson}`,
  };
}

/**
 * Emails every ADVISORY_TEAM_EMAILS address directly (bypassing the
 * NotificationDelivery/BullMQ email queue) so that "email delivery is
 * failing" as a monitored condition can't also swallow the alert meant to
 * report it, then logs a SecurityEvent for the trigger. Never throws —
 * failures are logged and swallowed, since this runs from fire-and-forget
 * worker event handlers.
 */
export async function sendAdminAlert(input: AdminAlertInput): Promise<void> {
  const recipients = parseAllowedEmails();
  const email = renderAlertEmail(input);

  if (recipients.length === 0) {
    console.error("No ADVISORY_TEAM_EMAILS configured; cannot send admin alert", input);
  } else {
    await Promise.all(
      recipients.map((to) =>
        sendTransactionalEmail({ to, ...email }).catch((error) => {
          console.error("Failed to send admin alert email:", to, error);
        })
      )
    );
  }

  await logSecurityEventNonBlocking({
    eventType: "ALERT_TRIGGERED",
    scope: input.category,
    identifier: "admin-alert",
    route: null,
    metadata: { summary: input.summary, details: input.details, recipientCount: recipients.length },
  });
}
