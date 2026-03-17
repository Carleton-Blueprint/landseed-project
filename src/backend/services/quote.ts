/**
 * Quote generation service with audit trail for pricing matrix and grant rules versions.
 * Implements FR-2.7: Auditing logic for tracking versions used in quote generation.
 */

import { PrismaClient, Prisma, NotificationEventType } from '@prisma/client';
import { enqueueNotification } from '@/backend/notifications/enqueue';

const prisma = new PrismaClient();

interface QuoteCalculationInput {
  projectId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}

interface QuoteResult {
  quoteId: string;
  subtotal: number;
  total: number;
  pricingMatrixVersion: number;
  grantRulesVersion: number;
}

/**
 * Get the currently active pricing matrix version.
 * In production, this would fetch the latest active version from the database.
 */
async function getActivePricingMatrixVersion() {
  const activeVersion = await prisma.pricingMatrixVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  if (!activeVersion) {
    throw new Error('No active pricing matrix version found');
  }

  return activeVersion;
}

/**
 * Get the currently active grant rules version.
 * In production, this would fetch the latest active version from the database.
 */
async function getActiveGrantRulesVersion() {
  const activeVersion = await prisma.grantRulesVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  if (!activeVersion) {
    throw new Error('No active grant rules version found');
  }

  return activeVersion;
}

/**
 * Apply grant rules to calculate adjustments/discounts.
 * This is a placeholder - implement based on logic.
 */
function applyGrantRules(subtotal: number, grantRules: Prisma.JsonValue): number {
  // Example: Apply percentage-based grant if rules specify
  const rules = grantRules as { discountPercentage?: number };
  if (rules.discountPercentage) {
    return subtotal * (1 - rules.discountPercentage / 100);
  }
  return subtotal;
}

/**
 * Generate a quote for a project with full audit trail.
 * Records which pricing matrix and grant rules versions were used.
 */
export async function generateQuote(
  input: QuoteCalculationInput
): Promise<QuoteResult> {
  const projectWithUser = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!projectWithUser) {
    throw new Error('Project not found');
  }

  // 1. Fetch active versions
  const pricingMatrixVersion = await getActivePricingMatrixVersion();
  const grantRulesVersion = await getActiveGrantRulesVersion();

  // 2. Calculate subtotal using pricing matrix data
  let subtotal = 0;
  for (const item of input.items) {
    // In production, you'd apply pricing matrix transformations here
    // For now, simple multiplication
    subtotal += item.quantity * item.unitPrice;
  }

  // 3. Apply grant rules to calculate total
  const total = applyGrantRules(subtotal, grantRulesVersion.rules);

  // 4. Create quote record with version audit trail
  const quote = await prisma.quote.create({
    data: {
      projectId: input.projectId,
      subtotal: new Prisma.Decimal(subtotal),
      total: new Prisma.Decimal(total),
      pricingMatrixVersionId: pricingMatrixVersion.id,
      grantRulesVersionId: grantRulesVersion.id,
    },
    include: {
      pricingMatrixVersion: true,
      grantRulesVersion: true,
    },
  });

  await prisma.project.update({
    where: { id: projectWithUser.id },
    data: { status: 'estimate_ready' },
  });

  if (projectWithUser.user.email) {
    const estimateBaseUrl =
      process.env.APP_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      'http://localhost:3000';
    await enqueueNotification({
      eventType: NotificationEventType.ESTIMATE_READY,
      idempotencyKey: `estimate-ready:${quote.id}`,
      recipientEmail: projectWithUser.user.email,
      recipientName: projectWithUser.user.name,
      userId: projectWithUser.user.id,
      projectId: projectWithUser.id,
      projectAddress: projectWithUser.address,
      estimateLink: `${estimateBaseUrl}/projects/${projectWithUser.id}/estimate`,
    });
  }

  return {
    quoteId: quote.id,
    subtotal: subtotal,
    total: total,
    pricingMatrixVersion: quote.pricingMatrixVersion.versionNumber,
    grantRulesVersion: quote.grantRulesVersion.versionNumber,
  };
}

/**
 * Create a new pricing matrix version with audit log.
 */
export async function createPricingMatrixVersion(
  data: Prisma.InputJsonValue,
  userId: string,
  changeSummary?: string
): Promise<string> {
  // Get previous active version for audit trail
  const previousVersion = await prisma.pricingMatrixVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  // Deactivate previous version
  if (previousVersion) {
    await prisma.pricingMatrixVersion.update({
      where: { id: previousVersion.id },
      data: { isActive: false },
    });
  }

  // Calculate next version number
  const maxVersion = await prisma.pricingMatrixVersion.findFirst({
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (maxVersion?.versionNumber ?? 0) + 1;

  // Create new version
  const newVersion = await prisma.pricingMatrixVersion.create({
    data: {
      versionNumber: nextVersionNumber,
      data: data,
      createdByUserId: userId,
      isActive: true,
    },
  });

  // Create audit log
  await prisma.pricingMatrixAuditLog.create({
    data: {
      versionId: newVersion.id,
      changedByUserId: userId,
      changeSummary: changeSummary || 'New pricing matrix version created',
      beforeState: previousVersion?.data ?? Prisma.JsonNull,
      afterState: data,
    },
  });

  return newVersion.id;
}

/**
 * Create a new grant rules version with audit log.
 */
export async function createGrantRulesVersion(
  rules: Prisma.InputJsonValue,
  userId: string,
  changeSummary?: string
): Promise<string> {
  // Get previous active version for audit trail
  const previousVersion = await prisma.grantRulesVersion.findFirst({
    where: { isActive: true },
    orderBy: { versionNumber: 'desc' },
  });

  // Deactivate previous version
  if (previousVersion) {
    await prisma.grantRulesVersion.update({
      where: { id: previousVersion.id },
      data: { isActive: false },
    });
  }

  // Calculate next version number
  const maxVersion = await prisma.grantRulesVersion.findFirst({
    orderBy: { versionNumber: 'desc' },
  });
  const nextVersionNumber = (maxVersion?.versionNumber ?? 0) + 1;

  // Create new version
  const newVersion = await prisma.grantRulesVersion.create({
    data: {
      versionNumber: nextVersionNumber,
      rules: rules,
      createdByUserId: userId,
      isActive: true,
    },
  });

  // Create audit log
  await prisma.grantRulesAuditLog.create({
    data: {
      versionId: newVersion.id,
      changedByUserId: userId,
      changeSummary: changeSummary || 'New grant rules version created',
      beforeState: previousVersion?.rules ?? Prisma.JsonNull,
      afterState: rules,
    },
  });

  return newVersion.id;
}

/**
 * Get audit history for a specific quote to see which versions were used.
 */
export async function getQuoteAuditHistory(quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      pricingMatrixVersion: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      grantRulesVersion: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      project: {
        select: { id: true, address: true },
      },
    },
  });

  if (!quote) {
    throw new Error('Quote not found');
  }

  return {
    quote: {
      id: quote.id,
      subtotal: quote.subtotal.toString(),
      total: quote.total.toString(),
      generatedAt: quote.generatedAt,
    },
    project: quote.project,
    versionsUsed: {
      pricingMatrix: {
        versionNumber: quote.pricingMatrixVersion.versionNumber,
        createdAt: quote.pricingMatrixVersion.createdAt,
        createdBy: quote.pricingMatrixVersion.createdBy,
      },
      grantRules: {
        versionNumber: quote.grantRulesVersion.versionNumber,
        createdAt: quote.grantRulesVersion.createdAt,
        createdBy: quote.grantRulesVersion.createdBy,
      },
    },
  };
}

/**
 * Get full audit trail for pricing matrix changes.
 */
export async function getPricingMatrixAuditTrail(limit = 50) {
  return prisma.pricingMatrixAuditLog.findMany({
    take: limit,
    orderBy: { changedAt: 'desc' },
    include: {
      version: {
        select: { versionNumber: true },
      },
      changedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Get full audit trail for grant rules changes.
 */
export async function getGrantRulesAuditTrail(limit = 50) {
  return prisma.grantRulesAuditLog.findMany({
    take: limit,
    orderBy: { changedAt: 'desc' },
    include: {
      version: {
        select: { versionNumber: true },
      },
      changedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}
