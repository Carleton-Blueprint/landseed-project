-- CreateTable
CREATE TABLE "IntakeDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guidedData" JSONB,
    "intakeData" JSONB,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeDraft_userId_key" ON "IntakeDraft"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeDraft_projectId_key" ON "IntakeDraft"("projectId");

-- AddForeignKey
ALTER TABLE "IntakeDraft" ADD CONSTRAINT "IntakeDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeDraft" ADD CONSTRAINT "IntakeDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
