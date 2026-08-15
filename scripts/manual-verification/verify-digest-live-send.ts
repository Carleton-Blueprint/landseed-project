/**
 * Manual verification script: Phase 2 of the "Email Service Validation and
 * Grant Discovery AI Verification" ticket — sends a real admin daily digest
 * through the live Resend integration and confirms both successful
 * delivery and the failure-logging path (AdminDigestDeliveryFailure).
 *
 * Requires: RESEND_API_KEY / EMAIL_FROM set to live values in .env, and a
 * database reachable via DATABASE_URL. Overrides ADVISORY_TEAM_EMAILS for
 * the duration of the run only (does not touch .env).
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

async function main() {
  console.log(`=== Step 1: live send to ${RECIPIENT} ===`);
  process.env.ADVISORY_TEAM_EMAILS = RECIPIENT;

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

  console.log(`\nCheck the inbox at ${RECIPIENT} now and confirm:`);
  console.log("  - the email arrived");
  console.log("  - it reads cleanly on a phone-width viewport (single column, no clipped text)");
  console.log("  - the copy is plain language, not raw eventType/scope codes");

  console.log(`\n=== Step 2: failure-logging path (invalid recipient: ${INVALID_RECIPIENT}) ===`);
  process.env.ADVISORY_TEAM_EMAILS = INVALID_RECIPIENT;

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

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
