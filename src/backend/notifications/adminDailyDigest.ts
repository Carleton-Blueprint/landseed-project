import { GrantApplicationStatus } from "@prisma/client";
import { prisma } from "lib/prisma";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const AT_RISK_LOOKBACK_MS = 4 * DEFAULT_LOOKBACK_MS;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;

type DigestItem = {
  projectId: string;
  projectAddress: string;
  reason: "NEW_SUBMISSION" | "MANUAL_REVIEW" | "BUILDERTREND_TRANSFER_FAILED" | "MISSING_CLIENT_INFO" | "AT_RISK_ESTIMATE";
  title: string;
  details: string;
  submittedAt?: Date;
  deadline?: Date;
  status?: string;
};

export type AdminDailyDigestData = {
  now: Date;
  since: Date;
  newSubmissions: DigestItem[];
  pendingStaffActions: DigestItem[];
  atRiskItems: DigestItem[];
  recipients: string[];
};

export type SendAdminDailyDigestResult = {
  sentCount: number;
  recipients: string[];
  summary: AdminDailyDigestData;
};

type DigestInput = {
  now?: Date;
  since?: Date;
  recipients?: string[];
};

function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isEnabled(): boolean {
  return (process.env.ADMIN_DAILY_DIGEST_ENABLED ?? "true").toLowerCase() === "true";
}

function getRecipients(inputRecipients?: string[]): string[] {
  if (inputRecipients?.length) return inputRecipients;
  return parseRecipients(process.env.ADMIN_DAILY_DIGEST_RECIPIENTS ?? process.env.ADVISORY_TEAM_EMAILS);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDigestSections(items: DigestItem[]): string {
  if (!items.length) {
    return "<p>No items to report.</p>";
  }

  const listItems = items
    .map((item) => {
      const meta = item.submittedAt ? `<div style="color:#6b7280;font-size:12px;">${escapeHtml(formatDate(item.submittedAt))}</div>` : "";
      const details = item.details ? `<div style="color:#374151;font-size:14px;">${escapeHtml(item.details)}</div>` : "";
      return `<li style="margin-bottom:10px;"><strong>${escapeHtml(item.title)}</strong><div style="color:#374151;font-size:14px;">${escapeHtml(item.projectAddress)}</div>${meta}${details}</li>`;
    })
    .join("");

  return `<ul style="padding-left:18px;">${listItems}</ul>`;
}

function buildDigestEmail(summary: AdminDailyDigestData): { subject: string; html: string; text: string } {
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const adminLink = `${appBaseUrl}/admin`;
  const sectionTitle = `Admin Daily Digest • ${formatDate(summary.now)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
      <h2 style="margin-bottom:8px;">${escapeHtml(sectionTitle)}</h2>
      <p style="margin-top:0;color:#4b5563;">${summary.newSubmissions.length} new submission(s), ${summary.pendingStaffActions.length} staff-action item(s), and ${summary.atRiskItems.length} at-risk request(s) were detected in the last 24 hours.</p>
      <h3 style="margin-top:20px;">New submissions</h3>
      ${buildDigestSections(summary.newSubmissions)}
      <h3 style="margin-top:20px;">Pending staff actions</h3>
      ${buildDigestSections(summary.pendingStaffActions)}
      <h3 style="margin-top:20px;">At risk of missing the refined estimate window</h3>
      ${buildDigestSections(summary.atRiskItems)}
      <p style="margin-top:20px;"><a href="${adminLink}" style="color:#0f766e;">Open the admin dashboard</a></p>
      <p style="color:#6b7280;font-size:12px;">Landseed Team</p>
    </div>
  `;

  const text = [
    sectionTitle,
    `${summary.newSubmissions.length} new submission(s), ${summary.pendingStaffActions.length} staff-action item(s), and ${summary.atRiskItems.length} at-risk request(s) were detected in the last 24 hours.`,
    "New submissions",
    summary.newSubmissions.length ? summary.newSubmissions.map((item) => `- ${item.projectAddress} (${item.title})`).join("\n") : "- None",
    "Pending staff actions",
    summary.pendingStaffActions.length ? summary.pendingStaffActions.map((item) => `- ${item.projectAddress} (${item.title})`).join("\n") : "- None",
    "At risk of missing the refined estimate window",
    summary.atRiskItems.length ? summary.atRiskItems.map((item) => `- ${item.projectAddress} (${item.title})`).join("\n") : "- None",
    `Open the admin dashboard: ${adminLink}`,
    "Landseed Team",
  ].join("\n\n");

  return {
    subject: `Landseed Admin Daily Digest • ${formatDate(summary.now)}`,
    html,
    text,
  };
}

function getTorontoUTCOffsetMs(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const torontoValues: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      torontoValues[part.type] = parseInt(part.value, 10);
    }
  }

  const torontoDate = new Date(
    torontoValues.year,
    torontoValues.month - 1,
    torontoValues.day,
    torontoValues.hour,
    torontoValues.minute,
    torontoValues.second
  );

  return date.getTime() - torontoDate.getTime();
}

function getRefinedEstimateDeadline(submittedAt: Date): Date {
  const offsetMs = getTorontoUTCOffsetMs(submittedAt);
  const torontoTimeMs = submittedAt.getTime() - offsetMs;

  const torontoDate = new Date(torontoTimeMs);
  const day = torontoDate.getUTCDay();
  const hour = torontoDate.getUTCHours();

  const isWeekday = day >= 1 && day <= 5;
  const isBusinessHours = isWeekday && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;

  let deadlineTorontoMs: number;

  if (isBusinessHours) {
    deadlineTorontoMs = torontoTimeMs + 24 * 60 * 60 * 1000;
  } else {
    const nextDayTorontoDate = new Date(torontoTimeMs);
    nextDayTorontoDate.setUTCDate(nextDayTorontoDate.getUTCDate() + 1);

    let nextBusinessDayTorontoDate = nextDayTorontoDate;
    while (
      nextBusinessDayTorontoDate.getUTCDay() === 0 ||
      nextBusinessDayTorontoDate.getUTCDay() === 6
    ) {
      nextBusinessDayTorontoDate = new Date(nextBusinessDayTorontoDate.getTime() + 24 * 60 * 60 * 1000);
    }

    nextBusinessDayTorontoDate.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0);
    deadlineTorontoMs = nextBusinessDayTorontoDate.getTime();
  }

  const deadlineOffsetMs = getTorontoUTCOffsetMs(new Date(deadlineTorontoMs + offsetMs));
  return new Date(deadlineTorontoMs + deadlineOffsetMs);
}

function isAtRiskForRefinedEstimate(submittedAt: Date, status: string | undefined, now: Date): boolean {
  if (status === "estimate_ready") {
    return false;
  }

  // if submitted more than 20 hours ago, it's at-risk of missing the 4–24 hour window.
  const ageMs = now.getTime() - submittedAt.getTime();
  const twentyHoursMs = 20 * 60 * 60 * 1000;
  return ageMs > twentyHoursMs;
}

export async function collectAdminDailyDigestData(input: DigestInput = {}): Promise<AdminDailyDigestData> {
  const now = input.now ?? new Date();
  const since = input.since ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
  const recipients = getRecipients(input.recipients);

  const riskSince = new Date(now.getTime() - AT_RISK_LOOKBACK_MS);

  const [submissionHistory, manualReviewFlags, failedTransfers, incompleteProjects, atRiskCandidates] = await Promise.all([
    prisma.grantApplicationStatusHistory.findMany({
      where: {
        toStatus: GrantApplicationStatus.SUBMITTED,
        changedAt: { gte: since },
      },
      select: {
        projectId: true,
        changedAt: true,
        project: {
          select: {
            id: true,
            address: true,
            status: true,
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { changedAt: "desc" },
    }),
    prisma.projectManualReviewFlag.findMany({
      where: {
        isActive: true,
      },
      select: {
        projectId: true,
        description: true,
        createdAt: true,
        project: {
          select: {
            id: true,
            address: true,
            status: true,
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.builderTrendTransfer.findMany({
      where: {
        status: "FAILED",
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            address: true,
            status: true,
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findMany({
      where: {
        OR: [{ user: { email: null } }, { user: { phone: null } }],
        status: { not: "draft" },
      },
      select: {
        id: true,
        address: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.grantApplicationStatusHistory.findMany({
      where: {
        toStatus: GrantApplicationStatus.SUBMITTED,
        changedAt: { gte: riskSince },
      },
      select: {
        projectId: true,
        changedAt: true,
        project: {
          select: {
            id: true,
            address: true,
            status: true,
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { changedAt: "desc" },
    }),
  ]);

  const newSubmissions: DigestItem[] = submissionHistory
    .filter((submission) => submission.project)
    .map((submission) => ({
      projectId: submission.projectId,
      projectAddress: submission.project.address || "Untitled project",
      reason: "NEW_SUBMISSION",
      title: "New submission received",
      details: `Submitted by ${submission.project.user?.name ?? "a client"}`,
      submittedAt: submission.changedAt,
      status: submission.project.status,
    }));

  const pendingStaffActions: DigestItem[] = [
    ...manualReviewFlags.map((flag) => ({
      projectId: flag.projectId,
      projectAddress: flag.project.address || "Untitled project",
      reason: "MANUAL_REVIEW" as const,
      title: "Manual review required",
      details: flag.description || "Project was flagged for manual review.",
      submittedAt: flag.createdAt,
      status: flag.project.status,
    })),
    ...failedTransfers.map((transfer) => ({
      projectId: transfer.projectId,
      projectAddress: transfer.project.address || "Untitled project",
      reason: "BUILDERTREND_TRANSFER_FAILED" as const,
      title: "BuilderTrend transfer failed",
      details: "The transfer to BuilderTrend failed and needs staff follow-up.",
      submittedAt: transfer.updatedAt,
      status: transfer.project.status,
    })),
    ...incompleteProjects.map((project) => ({
      projectId: project.id,
      projectAddress: project.address || "Untitled project",
      reason: "MISSING_CLIENT_INFO" as const,
      title: "Client information is incomplete",
      details: "The client profile is missing email or phone details.",
      submittedAt: project.createdAt,
      status: project.status,
    })),
  ];

  const atRiskItems = atRiskCandidates
    .filter((submission) => submission.project)
    .map((submission) => ({
      projectId: submission.projectId,
      projectAddress: submission.project.address || "Untitled project",
      reason: "AT_RISK_ESTIMATE" as const,
      title: "Estimate delivery at risk",
      details: `Submitted by ${submission.project.user?.name ?? "a client"}`,
      submittedAt: submission.changedAt,
      status: submission.project.status,
    }))
    .filter((submission) =>
      submission.submittedAt && isAtRiskForRefinedEstimate(submission.submittedAt, submission.status, now)
    );

  return {
    now,
    since,
    newSubmissions,
    pendingStaffActions,
    atRiskItems,
    recipients,
  };
}

export async function sendAdminDailyDigest(input: DigestInput = {}): Promise<SendAdminDailyDigestResult> {
  if (!isEnabled()) {
    return {
      sentCount: 0,
      recipients: [],
      summary: {
        now: input.now ?? new Date(),
        since: input.since ?? new Date((input.now ?? new Date()).getTime() - DEFAULT_LOOKBACK_MS),
        newSubmissions: [],
        pendingStaffActions: [],
        atRiskItems: [],
        recipients: [],
      },
    };
  }

  const recipients = getRecipients(input.recipients);
  if (!recipients.length) {
    return {
      sentCount: 0,
      recipients: [],
      summary: {
        now: input.now ?? new Date(),
        since: input.since ?? new Date((input.now ?? new Date()).getTime() - DEFAULT_LOOKBACK_MS),
        newSubmissions: [],
        pendingStaffActions: [],
        atRiskItems: [],
        recipients: [],
      },
    };
  }

  const summary = await collectAdminDailyDigestData(input);
  const { subject, html, text } = buildDigestEmail(summary);

  for (const recipient of recipients) {
    await sendTransactionalEmail({
      to: recipient,
      subject,
      html,
      text,
    });
  }

  return {
    sentCount: recipients.length,
    recipients,
    summary,
  };
}
