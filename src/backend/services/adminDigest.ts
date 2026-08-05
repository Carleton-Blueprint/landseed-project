/**
 * Daily admin digest: aggregates the last 24h of SecurityEvent rows
 * (rate-limit hits + alert triggers) and emails a summary to every
 * ADVISORY_TEAM_EMAILS address — the AC's "or the admin daily digest"
 * alternative to the immediate per-failure alerts in criticalFailureAlerts.ts.
 */
import { prisma } from "lib/prisma";
import { parseAllowedEmails } from "@/backend/auth/requireRole";
import { sendTransactionalEmail } from "@/backend/services/transactionalEmail";

export interface DigestGroupCount {
  eventType: string;
  scope: string;
  count: number;
}

export interface DailyDigest {
  windowStart: Date;
  windowEnd: Date;
  groups: DigestGroupCount[];
  totalEvents: number;
}

export async function buildDailyDigest(windowEnd: Date = new Date()): Promise<DailyDigest> {
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const grouped = await prisma.securityEvent.groupBy({
    by: ["eventType", "scope"],
    where: { createdAt: { gte: windowStart, lt: windowEnd } },
    _count: { _all: true },
    orderBy: { _count: { scope: "desc" } },
  });

  const groups: DigestGroupCount[] = grouped.map((row) => ({
    eventType: row.eventType,
    scope: row.scope,
    count: row._count._all,
  }));

  return {
    windowStart,
    windowEnd,
    groups,
    totalEvents: groups.reduce((sum, g) => sum + g.count, 0),
  };
}

function renderDigestEmail(digest: DailyDigest): { subject: string; html: string; text: string } {
  const dateLabel = digest.windowEnd.toISOString().slice(0, 10);

  if (digest.groups.length === 0) {
    return {
      subject: `[LandSeed Daily Digest] ${dateLabel} — no rate-limit hits or alerts`,
      html: `<p>No rate-limit hits or alert triggers in the last 24 hours.</p>`,
      text: "No rate-limit hits or alert triggers in the last 24 hours.",
    };
  }

  const rows = digest.groups
    .map((g) => `${g.eventType} / ${g.scope}: ${g.count}`)
    .join("\n");
  const htmlRows = digest.groups
    .map((g) => `<li>${g.eventType} / ${g.scope}: <strong>${g.count}</strong></li>`)
    .join("");

  return {
    subject: `[LandSeed Daily Digest] ${dateLabel} — ${digest.totalEvents} event(s)`,
    html: `<p>Rate-limit hits and alert triggers, last 24 hours:</p><ul>${htmlRows}</ul>`,
    text: `Rate-limit hits and alert triggers, last 24 hours:\n\n${rows}`,
  };
}

/** Builds and sends the daily digest to every allowlisted admin. Never throws. */
export async function sendDailyDigest(windowEnd: Date = new Date()): Promise<void> {
  try {
    const digest = await buildDailyDigest(windowEnd);
    const recipients = parseAllowedEmails();

    if (recipients.length === 0) {
      console.error("No ADVISORY_TEAM_EMAILS configured; cannot send admin daily digest");
      return;
    }

    const email = renderDigestEmail(digest);
    await Promise.all(
      recipients.map((to) =>
        sendTransactionalEmail({ to, ...email }).catch((error) => {
          console.error("Failed to send admin daily digest email:", to, error);
        })
      )
    );
  } catch (error) {
    console.error("Failed to build/send admin daily digest:", error);
  }
}
