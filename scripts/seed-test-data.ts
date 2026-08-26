/**
 * Seed a local test project with a staff note, for manually verifying the
 * admin dashboard's staff-notes and documents UI.
 *
 * Usage:
 *   npx tsx scripts/seed-test-data.ts
 */
import { prisma } from "lib/prisma";

async function main() {
  let user = await prisma.user.findUnique({ where: { email: "admin@landseed.org" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Admin Tester",
        email: "admin@landseed.org",
      },
    });
  }

  const project = await prisma.project.create({
    data: {
      address: "123 Test Street",
      userId: user.id,
    },
  });

  await prisma.projectStaffNote.create({
    data: {
      projectId: project.id,
      authorUserId: user.id,
      content: "This is a test staff note to verify the UI functionality!",
    },
  });

  console.log(`Seeded test project ${project.id} for ${user.email}`);
}

main()
  .catch((error) => {
    console.error("Failed to seed test data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
