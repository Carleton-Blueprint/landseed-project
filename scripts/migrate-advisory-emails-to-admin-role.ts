/**
 * One-time cutover: promote every user currently listed in the
 * ADVISORY_TEAM_EMAILS env allowlist to the DB-backed ADMIN role, so no
 * existing admin loses access when requireRole.ts stops reading that env
 * var. Safe to re-run (idempotent) but only meant to run once per environment.
 *
 * Usage:
 *   npx tsx scripts/migrate-advisory-emails-to-admin-role.ts
 */
import { parseAllowedEmails } from "@/backend/auth/requireRole";
import { prisma } from "lib/prisma";

async function main() {
  const emails = parseAllowedEmails();

  if (emails.length === 0) {
    console.log("ADVISORY_TEAM_EMAILS is empty — nothing to migrate.");
    return;
  }

  const result = await prisma.user.updateMany({
    where: { email: { in: emails } },
    data: { role: "ADMIN" },
  });

  console.log(`Promoted ${result.count} of ${emails.length} advisory-team email(s) to ADMIN.`);

  const matchedEmails = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const matchedSet = new Set(matchedEmails.map((u) => u.email));
  const unmatched = emails.filter((email) => !matchedSet.has(email));
  if (unmatched.length > 0) {
    console.warn(`No user account found for: ${unmatched.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error("Failed to migrate advisory emails to admin role:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
