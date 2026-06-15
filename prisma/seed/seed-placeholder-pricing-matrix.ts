/**
 * One-time seed: creates a placeholder PricingMatrixVersion (version 0).
 *
 * Context: pricing is now fully AI/SerpAPI-driven (see refinedEstimate.ts).
 * The PricingMatrixVersion table is no longer used as a pricing source,
 * but Quote.pricingMatrixVersionId is a required FK, so generateQuote()
 * still needs an active version row to satisfy getActivePricingMatrixVersion().
 *
 * This script creates a single inert "version 0" row marked active, and
 * deactivates any pre-existing active versions so getActivePricingMatrixVersion()
 * deterministically resolves to this placeholder.
 *
 * Idempotent: safe to run multiple times.
 *
 * Usage:
 *   npx tsx seed/seed-placeholder-pricing-matrix.ts
 *
 * Requires SYSTEM_USER_ID env var (or pass --userId=<id>), since
 * PricingMatrixVersion.createdByUserId is a required FK to User.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLACEHOLDER_VERSION_NUMBER = 0;

async function resolveSystemUserId(): Promise<string> {
  const argUserId = process.argv
    .find((arg) => arg.startsWith('--userId='))
    ?.split('=')[1];

  const userId = argUserId ?? process.env.SYSTEM_USER_ID;

  if (userId) {
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      throw new Error(`No User found with id "${userId}". Pass a valid --userId=<id> or SYSTEM_USER_ID.`);
    }
    return userId;
  }

  // Fallback: use the earliest-created user as the "system" actor for this
  // administrative/placeholder record. Adjust if you have a dedicated
  // service/system account.
  const fallbackUser = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });

  if (!fallbackUser) {
    throw new Error(
      'No users found in the database, and no SYSTEM_USER_ID/--userId provided. ' +
        'Cannot satisfy PricingMatrixVersion.createdByUserId.'
    );
  }

  console.warn(
    `No SYSTEM_USER_ID provided. Falling back to earliest user (${fallbackUser.email ?? fallbackUser.id}) ` +
      'as createdByUserId for the placeholder pricing matrix version.'
  );

  return fallbackUser.id;
}

async function main() {
  const existingPlaceholder = await prisma.pricingMatrixVersion.findUnique({
    where: { versionNumber: PLACEHOLDER_VERSION_NUMBER },
  });

  if (existingPlaceholder) {
    if (!existingPlaceholder.isActive) {
      console.log('Placeholder version 0 exists but is not active. Reactivating and deactivating others...');
      await prisma.$transaction([
        prisma.pricingMatrixVersion.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        }),
        prisma.pricingMatrixVersion.update({
          where: { id: existingPlaceholder.id },
          data: { isActive: true },
        }),
      ]);
      console.log('Done. Placeholder version 0 is now active.');
      return;
    }

    console.log('Placeholder version 0 already exists and is active. Nothing to do.');
    return;
  }

  const createdByUserId = await resolveSystemUserId();

  await prisma.$transaction(async (tx) => {
    await tx.pricingMatrixVersion.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    const placeholder = await tx.pricingMatrixVersion.create({
      data: {
        versionNumber: PLACEHOLDER_VERSION_NUMBER,
        data: {
          note:
            'Placeholder pricing matrix. Pricing is sourced from SerpAPI / mock AI ' +
            'estimation (see refinedEstimate.ts), not from this table. ' +
            'This row exists solely to satisfy Quote.pricingMatrixVersionId.',
          deprecated: true,
        },
        createdByUserId,
        isActive: true,
      },
    });

    await tx.pricingMatrixAuditLog.create({
      data: {
        versionId: placeholder.id,
        changedByUserId: createdByUserId,
        changeSummary:
          'Created placeholder pricing matrix version (v0) to unblock FR-2.5a. ' +
          'Pricing matrix is no longer used as a pricing source.',
        beforeState: undefined,
        afterState: placeholder.data as any,
      },
    });
  });

  console.log('Created and activated placeholder PricingMatrixVersion v0.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
