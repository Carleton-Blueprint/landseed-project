/**
 * Seed or update a local test user with a password hash for credentials sign-in.
 *
 * Usage:
 *   npx tsx scripts/seed-test-user.ts
 *
 * Optional env overrides:
 *   SEED_TEST_USER_EMAIL, SEED_TEST_USER_PASSWORD, SEED_TEST_USER_NAME
 */
import { hashPassword } from "@/backend/auth/password";
import { prisma } from "lib/prisma";

const email = (process.env.SEED_TEST_USER_EMAIL ?? "test@landseed.local").trim().toLowerCase();
const password = process.env.SEED_TEST_USER_PASSWORD ?? "password123";
const name = process.env.SEED_TEST_USER_NAME ?? "Test User";

async function main() {
  const passwordHash = await hashPassword(password);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      passwordHash,
    } as any,
    update: {
      name,
      passwordHash,
    } as any,
  });

  console.log(`Seeded test user: ${user.email} (id: ${user.id})`);
}

main()
  .catch((error) => {
    console.error("Failed to seed test user:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
