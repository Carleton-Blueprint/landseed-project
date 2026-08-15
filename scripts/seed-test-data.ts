import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  let user = await prisma.user.findUnique({ where: { email: "admin@landseed.org" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Admin Tester",
        email: "admin@landseed.org"
      }
    });
  }
  
  const project = await prisma.project.create({
    data: {
      address: "123 Test Street",
      userId: user.id
    }
  });
  
  await prisma.projectStaffNote.create({
    data: {
      projectId: project.id,
      authorUserId: user.id,
      content: "This is a test staff note to verify the UI functionality!"
    }
  });
  
  console.log("Seeded test data!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
