/**
 * Manual verification script: Phase 2 of the "Email Service Validation and
 * Grant Discovery AI Verification" ticket — sends a real admin daily digest
 * through the live Resend integration and confirms both successful
 * delivery and the failure-logging path (AdminDigestDeliveryFailure).
 *
 * Requires: RESEND_API_KEY / EMAIL_FROM set to live values in .env, and a
 * database reachable via DATABASE_URL. sendDailyDigest emails every
 * DB-backed ADMIN user (see getAdminEmails in requireRole.ts) — this script
 * temporarily promotes/creates a user for each recipient it needs and
 * restores/deletes it afterward, but it will ALSO email any other ADMIN
 * user already in the connected database. Only run this against a local/dev
 * database with no real admins you don't want emailed.
 *
 * Usage:
 *   npx tsx scripts/manual-verification/verify-digest-live-send.ts
 *   DIGEST_VERIFY_RECIPIENT=someone@example.com npx tsx scripts/manual-verification/verify-digest-live-send.ts
 */
import "dotenv/config";
import { prisma } from "lib/prisma";
import { sendDailyDigest } from "@/backend/services/adminDigest";

const RECIPIENT = process.env.DIGEST_VERIFY_RECIPIENT ?? "greatnnaji04@gmail.com";
const INVALID_RECIPIENT = "not-a-real-address@invalid-domain-for-verification.test";

async function latestRun() {
  return prisma.adminDigestRun.findFirst({ orderBy: { sentAt: "desc" } });
}

/** Temporarily makes `email` an ADMIN for the duration of `fn`, then restores/removes it. */
async function withTemporaryAdmin<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
  } else {
    await prisma.user.create({ data: { email, name: "Digest Verification (temp)", role: "ADMIN" } });
  }

  try {
    return await fn();
  } finally {
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: existing.role } });
    } else {
      await prisma.user.delete({ where: { email } });
    }
  }
}

async function main() {
  console.log(`=== Step 1: live send to ${RECIPIENT} ===`);

  await withTemporaryAdmin(RECIPIENT, async () => {
    const before = await latestRun();
    await sendDailyDigest(new Date());
    const successRun = await latestRun();

    if (!successRun || successRun.id === before?.id) {
      console.error("FAIL: no new AdminDigestRun was recorded for the send");
    } else {
      console.log("PASS: AdminDigestRun recorded:", {
        id: successRun.id,
        newSubmissionCount: successRun.newSubmissionCount,
        staffActionCount: successRun.staffActionCount,
        eventCount: successRun.eventCount,
      });

      const failures = await prisma.adminDigestDeliveryFailure.findMany({
        where: { digestRunId: successRun.id },
      });
      console.log(
        failures.length === 0
          ? "PASS: no delivery failures recorded for a valid recipient"
          : `FAIL: unexpected delivery failures: ${JSON.stringify(failures)}`
      );
    }
  });

  console.log(`\nCheck the inbox at ${RECIPIENT} now and confirm:`);
  console.log("  - the email arrived");
  console.log("  - it reads cleanly on a phone-width viewport (single column, no clipped text)");
  console.log("  - the copy is plain language, not raw eventType/scope codes");

  console.log(`\n=== Step 2: failure-logging path (invalid recipient: ${INVALID_RECIPIENT}) ===`);

  await withTemporaryAdmin(INVALID_RECIPIENT, async () => {
    await sendDailyDigest(new Date());
    const failureRun = await latestRun();
    const failures = failureRun
      ? await prisma.adminDigestDeliveryFailure.findMany({ where: { digestRunId: failureRun.id } })
      : [];

    if (failures.length > 0) {
      console.log("PASS: delivery failure captured with error detail:");
      console.log(`  recipient: ${failures[0].recipientEmail}`);
      console.log(`  error: ${failures[0].errorMessage}`);
    } else {
      console.error("FAIL: expected a delivery failure to be recorded for an invalid recipient");
    }
  });

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
