-- CreateTable
CREATE TABLE "ProjectStaffNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStaffNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectStaffNote_projectId_idx" ON "ProjectStaffNote"("projectId");

-- CreateIndex
CREATE INDEX "ProjectStaffNote_authorUserId_idx" ON "ProjectStaffNote"("authorUserId");

-- CreateIndex
CREATE INDEX "ProjectStaffNote_createdAt_idx" ON "ProjectStaffNote"("createdAt");

-- AddForeignKey
ALTER TABLE "ProjectStaffNote" ADD CONSTRAINT "ProjectStaffNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStaffNote" ADD CONSTRAINT "ProjectStaffNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
