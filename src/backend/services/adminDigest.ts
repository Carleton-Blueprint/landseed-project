/**
 * Daily admin digest: summarizes the last 24h for the admin team —
 * new submissions, requests needing staff action (active manual-review
 * flags), estimates pending client review, information requests that have
 * gone unanswered for more than STALE_INFO_REQUEST_DAYS, and the last 24h
 * of SecurityEvent rows (rate-limit hits + alert triggers) — emailed to
 * every ADMIN user. The security-event summary is also the AC's "or the
 * admin daily digest" alternative to the immediate per-failure alerts in
 * criticalFailureAlerts.ts.
 *
 * Every successful send is recorded to AdminDigestRun so a restarted
 * worker can tell whether a scheduled send was missed while it was down
 * (see runCatchUpIfNeeded) and catch up with one summary covering the gap
 * instead of silently skipping it. Per-recipient send failures are
 * recorded to AdminDigestDeliveryFailure instead of only being logged.
 */
import { prisma } from "lib/prisma";
import { getAdminEmails } from "@/backend/auth/requireRole";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";

export interface DigestGroupCount {
  eventType: string;
  scope: string;
  count: number;
}

export interface NewSubmissionSummary {
  projectId: string;
  address: string;
  createdAt: Date;
}

export interface StaffActionItem {
  projectId: string;
  address: string;
  reason: string;
}

export interface PendingEstimateSummary {
  projectId: string;
  address: string;
  quoteId: string;
  pendingSince: Date;
}

export interface StaleInfoRequestSummary {
  projectId: string;
  address: string;
  subject: string;
  askedAt: Date;
}

export interface DailyDigest {
  windowStart: Date;
  windowEnd: Date;
  groups: DigestGroupCount[];
  totalEvents: number;
  newSubmissions: NewSubmissionSummary[];
  staffActionItems: StaffActionItem[];
  estimatesPendingReview: PendingEstimateSummary[];
  staleInformationRequests: StaleInfoRequestSummary[];
}

const STALE_INFO_REQUEST_DAYS = 7;

const MANUAL_REVIEW_REASON_LABELS: Record<string, string> = {
  LOW_CONFIDENCE: "Grant discovery returned low-confidence results",
  HIGH_COMPLEXITY: "Project flagged as high complexity",
  BOTH: "Low-confidence grant discovery and high complexity",
  PHOTO_MODIFICATION_MISMATCH: "Submitted photos don't match the requested modification",
};

export async function buildDailyDigest(
  windowEnd: Date = new Date(),
  windowStart: Date = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)
): Promise<DailyDigest> {
  const staleInfoRequestCutoff = new Date(
    windowEnd.getTime() - STALE_INFO_REQUEST_DAYS * 24 * 60 * 60 * 1000
  );

  const [grouped, newProjects, manualReviewFlags, pendingQuotes, staleQuestions] = await Promise.all([
    prisma.securityEvent.groupBy({
      by: ["eventType", "scope"],
      where: { createdAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
      orderBy: { _count: { scope: "desc" } },
    }),
    prisma.project.findMany({
      where: { createdAt: { gte: windowStart, lt: windowEnd } },
      select: { id: true, address: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.projectManualReviewFlag.findMany({
      where: { isActive: true },
      select: { reason: true, project: { select: { id: true, address: true } } },
    }),
    prisma.quote.findMany({
      where: { status: "PENDING" },
      select: { id: true, generatedAt: true, project: { select: { id: true, address: true } } },
    }),
    prisma.quoteQuestion.findMany({
      where: { status: "OPEN", createdAt: { lt: staleInfoRequestCutoff } },
      select: {
        subject: true,
        createdAt: true,
        quote: { select: { project: { select: { id: true, address: true } } } },
      },
    }),
  ]);

  const groups: DigestGroupCount[] = grouped.map((row) => ({
    eventType: row.eventType,
    scope: row.scope,
    count: row._count._all,
  }));

  const newSubmissions: NewSubmissionSummary[] = newProjects.map((project) => ({
    projectId: project.id,
    address: project.address,
    createdAt: project.createdAt,
  }));

  const staffActionItems: StaffActionItem[] = manualReviewFlags.map((flag) => ({
    projectId: flag.project.id,
    address: flag.project.address,
    reason: MANUAL_REVIEW_REASON_LABELS[flag.reason] ?? "Needs manual review",
  }));

  const estimatesPendingReview: PendingEstimateSummary[] = pendingQuotes.map((quote) => ({
    projectId: quote.project.id,
    address: quote.project.address,
    quoteId: quote.id,
    pendingSince: quote.generatedAt,
  }));

  const staleInformationRequests: StaleInfoRequestSummary[] = staleQuestions.map((question) => ({
    projectId: question.quote.project.id,
    address: question.quote.project.address,
    subject: question.subject,
    askedAt: question.createdAt,
  }));

  return {
    windowStart,
    windowEnd,
    groups,
    totalEvents: groups.reduce((sum, g) => sum + g.count, 0),
    newSubmissions,
    staffActionItems,
    estimatesPendingReview,
    staleInformationRequests,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SECURITY_EVENT_LABELS: Record<string, string> = {
  RATE_LIMIT_HIT: "rate-limit hit",
  ALERT_TRIGGERED: "alert triggered",
};

function htmlSection(title: string, itemsHtml: string[]): string {
  if (itemsHtml.length === 0) {
    return "";
  }
  return `
    <tr>
      <td style="padding: 16px 0 8px 0;">
        <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1a1a1a;">${title}</p>
        <ul style="margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.6; color: #333333;">
          ${itemsHtml.join("")}
        </ul>
      </td>
    </tr>`;
}

function renderDigestEmail(
  digest: DailyDigest,
  isCatchUp: boolean
): { subject: string; html: string; text: string } {
  const dateLabel = digest.windowEnd.toISOString().slice(0, 10);
  const rangeLabel = `${digest.windowStart.toISOString().slice(0, 10)} to ${dateLabel}`;
  const prefix = isCatchUp ? "[LandSeed Daily Digest — Catch-up]" : "[LandSeed Daily Digest]";
  const periodLabel = isCatchUp ? `the missed period (${rangeLabel})` : "the last 24 hours";

  const nothingToReport =
    digest.newSubmissions.length === 0 &&
    digest.staffActionItems.length === 0 &&
    digest.estimatesPendingReview.length === 0 &&
    digest.staleInformationRequests.length === 0 &&
    digest.groups.length === 0;

  const subjectParts: string[] = [];
  if (digest.newSubmissions.length > 0) {
    subjectParts.push(`${digest.newSubmissions.length} new request(s)`);
  }
  if (digest.staffActionItems.length > 0) {
    subjectParts.push(`${digest.staffActionItems.length} need${digest.staffActionItems.length === 1 ? "s" : ""} action`);
  }
  if (digest.estimatesPendingReview.length > 0) {
    subjectParts.push(`${digest.estimatesPendingReview.length} pending estimate(s)`);
  }
  if (digest.staleInformationRequests.length > 0) {
    subjectParts.push(`${digest.staleInformationRequests.length} stale info request(s)`);
  }
  const subject = nothingToReport
    ? `${prefix} ${dateLabel} — nothing to report`
    : `${prefix} ${dateLabel} — ${subjectParts.join(", ") || `${digest.totalEvents} security event(s)`}`;

  const introText = isCatchUp
    ? `The admin digest was delayed, so this catches up on ${periodLabel}.`
    : `Here's what happened over ${periodLabel}.`;

  const newSubmissionsHtml = digest.newSubmissions.map(
    (s) => `<li>${escapeHtml(s.address)} — submitted ${s.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</li>`
  );
  const staffActionHtml = digest.staffActionItems.map(
    (item) => `<li>${escapeHtml(item.address)} — ${escapeHtml(item.reason)}</li>`
  );
  const pendingEstimateHtml = digest.estimatesPendingReview.map(
    (item) =>
      `<li>${escapeHtml(item.address)} — pending since ${item.pendingSince.toISOString().slice(0, 10)}</li>`
  );
  const staleInfoRequestHtml = digest.staleInformationRequests.map(
    (item) =>
      `<li>${escapeHtml(item.address)} — ${escapeHtml(item.subject)} (asked ${item.askedAt.toISOString().slice(0, 10)})</li>`
  );
  const securityEventHtml = digest.groups.map(
    (g) => `<li>${escapeHtml(SECURITY_EVENT_LABELS[g.eventType] ?? g.eventType)} (${escapeHtml(g.scope)}): <strong>${g.count}</strong></li>`
  );

  const sectionsHtml = [
    htmlSection("New requests", newSubmissionsHtml),
    htmlSection("Needs staff action", staffActionHtml),
    htmlSection("Estimates pending review", pendingEstimateHtml),
    htmlSection("Information requests needing follow-up", staleInfoRequestHtml),
    htmlSection("Security activity", securityEventHtml),
  ]
    .filter(Boolean)
    .join("");

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%; background-color: #ffffff; border-radius: 8px; padding: 24px; font-family: -apple-system, Helvetica, Arial, sans-serif;">
            <tr>
              <td style="padding-bottom: 12px;">
                <p style="margin: 0; font-size: 18px; font-weight: 700; color: #1a1a1a;">LandSeed Daily Digest</p>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #666666;">${escapeHtml(introText)}</p>
              </td>
            </tr>
            ${sectionsHtml || `<tr><td style="padding: 8px 0; font-size: 15px; color: #333333;">Nothing to report ${escapeHtml(periodLabel)}.</td></tr>`}
          </table>
        </td>
      </tr>
    </table>`;

  const textLines = [introText, ""];
  if (digest.newSubmissions.length > 0) {
    textLines.push(
      "New requests:",
      ...digest.newSubmissions.map((s) => `- ${s.address} — submitted ${s.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`),
      ""
    );
  }
  if (digest.staffActionItems.length > 0) {
    textLines.push("Needs staff action:", ...digest.staffActionItems.map((item) => `- ${item.address} — ${item.reason}`), "");
  }
  if (digest.estimatesPendingReview.length > 0) {
    textLines.push(
      "Estimates pending review:",
      ...digest.estimatesPendingReview.map(
        (item) => `- ${item.address} — pending since ${item.pendingSince.toISOString().slice(0, 10)}`
      ),
      ""
    );
  }
  if (digest.staleInformationRequests.length > 0) {
    textLines.push(
      "Information requests needing follow-up:",
      ...digest.staleInformationRequests.map(
        (item) => `- ${item.address} — ${item.subject} (asked ${item.askedAt.toISOString().slice(0, 10)})`
      ),
      ""
    );
  }
  if (digest.groups.length > 0) {
    textLines.push(
      "Security activity:",
      ...digest.groups.map((g) => `- ${SECURITY_EVENT_LABELS[g.eventType] ?? g.eventType} (${g.scope}): ${g.count}`),
      ""
    );
  }
  if (nothingToReport) {
    textLines.push(`Nothing to report over ${periodLabel}.`);
  }

  return {
    subject,
    html,
    text: textLines.join("\n").trim(),
  };
}

export interface SendDigestOptions {
  /** Defaults to 24h before windowEnd. Catch-up sends pass the gap since the last run. */
  windowStart?: Date;
  isCatchUp?: boolean;
}

/**
 * Builds and sends the digest to every admin, then records the run (even
 * with zero recipients, so having no ADMIN users configured can't cause
 * runCatchUpIfNeeded to retry forever). Never throws. A build failure is
 * not recorded, so it's correctly picked up as a missed run on the next
 * catch-up check.
 */
export async function sendDailyDigest(
  windowEnd: Date = new Date(),
  options: SendDigestOptions = {}
): Promise<void> {
  try {
    const digest = await buildDailyDigest(windowEnd, options.windowStart);
    const recipients = await getAdminEmails();

    const failures: { recipientEmail: string; errorMessage: string }[] = [];

    if (recipients.length === 0) {
      console.error("No ADMIN users found; cannot send admin daily digest");
    } else {
      const email = renderDigestEmail(digest, options.isCatchUp ?? false);
      await Promise.all(
        recipients.map((to) =>
          sendTransactionalEmail({ to, ...email }).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Failed to send admin daily digest email:", to, errorMessage);
            failures.push({ recipientEmail: to, errorMessage });
          })
        )
      );
    }

    const run = await prisma.adminDigestRun.create({
      data: {
        windowStart: digest.windowStart,
        windowEnd: digest.windowEnd,
        eventCount: digest.totalEvents,
        newSubmissionCount: digest.newSubmissions.length,
        staffActionCount: digest.staffActionItems.length,
        pendingEstimateCount: digest.estimatesPendingReview.length,
        staleInfoRequestCount: digest.staleInformationRequests.length,
      },
    });

    if (failures.length > 0) {
      await prisma.adminDigestDeliveryFailure.createMany({
        data: failures.map((failure) => ({ digestRunId: run.id, ...failure })),
      });
    }
  } catch (error) {
    console.error("Failed to build/send admin daily digest:", error);
  }
}

/** The most recent daily-digest target time (digestHourUtc, today or a prior day) that is <= now. */
function mostRecentScheduledFireTime(digestHourUtc: number, now: Date): Date {
  const todayTarget = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), digestHourUtc, 0, 0, 0)
  );
  if (todayTarget.getTime() <= now.getTime()) {
    return todayTarget;
  }
  const yesterdayTarget = new Date(todayTarget);
  yesterdayTarget.setUTCDate(yesterdayTarget.getUTCDate() - 1);
  return yesterdayTarget;
}

/**
 * Called once on worker startup. If the worker was down across a scheduled
 * digest time, sends a single catch-up digest covering everything since
 * the last successful run and returns { sent: true }. A brand-new
 * deployment (no prior run at all) is not treated as a miss. Never throws.
 */
export async function runCatchUpIfNeeded(
  digestHourUtc: number,
  now: Date = new Date()
): Promise<{ sent: boolean }> {
  try {
    const lastRun = await prisma.adminDigestRun.findFirst({ orderBy: { sentAt: "desc" } });
    if (!lastRun) {
      return { sent: false };
    }

    const dueAt = mostRecentScheduledFireTime(digestHourUtc, now);
    if (lastRun.sentAt >= dueAt) {
      return { sent: false };
    }

    await sendDailyDigest(now, { windowStart: lastRun.windowEnd, isCatchUp: true });
    return { sent: true };
  } catch (error) {
    console.error("Failed to check for missed admin digests:", error);
    return { sent: false };
  }
}
