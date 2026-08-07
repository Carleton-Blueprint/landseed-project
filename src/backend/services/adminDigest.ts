/**
 * Daily admin digest: aggregates the last 24h of SecurityEvent rows
 * (rate-limit hits + alert triggers) and emails a summary to every
 * ADVISORY_TEAM_EMAILS address — the AC's "or the admin daily digest"
 * alternative to the immediate per-failure alerts in criticalFailureAlerts.ts.
 *
 * Every successful send is recorded to AdminDigestRun so a restarted
 * worker can tell whether a scheduled send was missed while it was down
 * (see runCatchUpIfNeeded) and catch up with one summary covering the gap
 * instead of silently skipping it.
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

export async function buildDailyDigest(
  windowEnd: Date = new Date(),
  windowStart: Date = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)
): Promise<DailyDigest> {
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

function renderDigestEmail(
  digest: DailyDigest,
  isCatchUp: boolean
): { subject: string; html: string; text: string } {
  const dateLabel = digest.windowEnd.toISOString().slice(0, 10);
  const rangeLabel = `${digest.windowStart.toISOString().slice(0, 10)} to ${dateLabel}`;
  const prefix = isCatchUp ? "[LandSeed Daily Digest — Catch-up]" : "[LandSeed Daily Digest]";
  const intro = isCatchUp
    ? `Catch-up digest — the admin digest worker was offline and missed its scheduled send. This covers ${rangeLabel}.`
    : "Rate-limit hits and alert triggers, last 24 hours:";

  if (digest.groups.length === 0) {
    const emptyMessage = isCatchUp
      ? `No rate-limit hits or alert triggers for the missed period (${rangeLabel}).`
      : "No rate-limit hits or alert triggers in the last 24 hours.";
    return {
      subject: `${prefix} ${dateLabel} — no rate-limit hits or alerts`,
      html: `<p>${emptyMessage}</p>`,
      text: emptyMessage,
    };
  }

  const rows = digest.groups.map((g) => `${g.eventType} / ${g.scope}: ${g.count}`).join("\n");
  const htmlRows = digest.groups
    .map((g) => `<li>${g.eventType} / ${g.scope}: <strong>${g.count}</strong></li>`)
    .join("");

  return {
    subject: `${prefix} ${dateLabel} — ${digest.totalEvents} event(s)`,
    html: `<p>${intro}</p><ul>${htmlRows}</ul>`,
    text: `${intro}\n\n${rows}`,
  };
}

export interface SendDigestOptions {
  /** Defaults to 24h before windowEnd. Catch-up sends pass the gap since the last run. */
  windowStart?: Date;
  isCatchUp?: boolean;
}

/**
 * Builds and sends the digest to every allowlisted admin, then records the
 * run (even with zero recipients configured, so a misconfigured
 * ADVISORY_TEAM_EMAILS can't cause runCatchUpIfNeeded to retry forever).
 * Never throws. A build failure is not recorded, so it's correctly picked
 * up as a missed run on the next catch-up check.
 */
export async function sendDailyDigest(
  windowEnd: Date = new Date(),
  options: SendDigestOptions = {}
): Promise<void> {
  try {
    const digest = await buildDailyDigest(windowEnd, options.windowStart);
    const recipients = parseAllowedEmails();

    if (recipients.length === 0) {
      console.error("No ADVISORY_TEAM_EMAILS configured; cannot send admin daily digest");
    } else {
      const email = renderDigestEmail(digest, options.isCatchUp ?? false);
      await Promise.all(
        recipients.map((to) =>
          sendTransactionalEmail({ to, ...email }).catch((error) => {
            console.error("Failed to send admin daily digest email:", to, error);
          })
        )
      );
    }

    await prisma.adminDigestRun.create({
      data: {
        windowStart: digest.windowStart,
        windowEnd: digest.windowEnd,
        eventCount: digest.totalEvents,
      },
    });
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
