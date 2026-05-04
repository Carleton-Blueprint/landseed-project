-- CreateTable
CREATE TABLE "DeclineSurveyResponse" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "primaryReason" TEXT NOT NULL,
    "subReasons" JSONB,
    "satisfactionRating" INTEGER,
    "additionalComments" TEXT,
    "wouldReconsider" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclineSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeclineSurveyResponse_quoteId_key" ON "DeclineSurveyResponse"("quoteId");

-- CreateIndex
CREATE INDEX "DeclineSurveyResponse_primaryReason_idx" ON "DeclineSurveyResponse"("primaryReason");

-- CreateIndex
CREATE INDEX "DeclineSurveyResponse_createdAt_idx" ON "DeclineSurveyResponse"("createdAt");

-- AddForeignKey
ALTER TABLE "DeclineSurveyResponse" ADD CONSTRAINT "DeclineSurveyResponse_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
