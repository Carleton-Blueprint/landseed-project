-- CreateTable
CREATE TABLE "QuoteOverride" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "overriddenByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "previousTotal" DECIMAL(10,2) NOT NULL,
    "lineItems" JSONB NOT NULL,
    "modificationCodes" JSONB NOT NULL,
    "eligibilityDecision" "EligibilityDecision" NOT NULL,
    "grantOverrides" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteOverride_quoteId_key" ON "QuoteOverride"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteOverride_quoteId_idx" ON "QuoteOverride"("quoteId");

-- AddForeignKey
ALTER TABLE "QuoteOverride" ADD CONSTRAINT "QuoteOverride_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOverride" ADD CONSTRAINT "QuoteOverride_overriddenByUserId_fkey" FOREIGN KEY ("overriddenByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
