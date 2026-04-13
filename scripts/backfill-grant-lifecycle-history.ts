import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projectsWithoutHistory = await prisma.project.findMany({
    where: {
      grantApplicationStatusHistory: {
        none: {},
      },
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      grantApplicationStatus: true,
    },
  });

  if (projectsWithoutHistory.length === 0) {
    console.log("No projects require grant lifecycle history backfill.");
    return;
  }

  await prisma.$transaction(
    projectsWithoutHistory.map((project) =>
      prisma.grantApplicationStatusHistory.create({
        data: {
          projectId: project.id,
          fromStatus: null,
          toStatus: project.grantApplicationStatus,
          changedByUserId: project.userId,
          changedAt: project.createdAt,
          metadata: {
            source: "backfill_grant_lifecycle_history",
          },
        },
      })
    )
  );

  console.log(
    `Backfilled grant lifecycle history for ${projectsWithoutHistory.length} project(s).`
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
