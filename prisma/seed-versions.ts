/**
 * Seed script to initialize pricing matrix versions.
 * Run this after applying migrations to set up initial pricing defaults.
 *
 * Usage: npx tsx prisma/seed-versions.ts
 * Run: npm run db:seed-versions
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial pricing matrix versions...\n');

  const existingPricing = await prisma.pricingMatrixVersion.count();

  if (existingPricing > 0) {
    console.log('Pricing matrix versions already exist. Skipping seed to prevent duplicates.');
    console.log(`Pricing Matrix Versions: ${existingPricing}\n`);
    return;
  }

  let systemUser = await prisma.user.findFirst({
    where: { email: 'system@landseed.com' },
  });

  if (!systemUser) {
    console.log('Creating system user for initial versions...');
    systemUser = await prisma.user.create({
      data: {
        email: 'system@landseed.com',
        name: 'System',
      },
    });
    console.log('System user created\n');
  }

  console.log('Creating initial pricing matrix version...');
  const initialPricingMatrix = {
    version: '1.0.0',
    description: 'Initial pricing matrix for standard home repairs',
    categories: {
      labor: {
        baseRate: 75,
        skilledRate: 125,
      },
      materials: {
        paint: {
          interior: 35,
          exterior: 45,
        },
        lumber: {
          standard: 8,
          treated: 12,
        },
        roofing: {
          shingles: 95,
          flashing: 25,
        },
        flooring: {
          vinyl: 3.5,
          hardwood: 8,
          tile: 6,
        },
      },
      markups: {
        materialMarkup: 1.15,
        contingency: 0.1,
      },
    },
    effectiveDate: new Date().toISOString(),
  };

  const pricingVersion = await prisma.pricingMatrixVersion.create({
    data: {
      versionNumber: 1,
      data: initialPricingMatrix,
      createdByUserId: systemUser.id,
      isActive: true,
    },
  });

  await prisma.pricingMatrixAuditLog.create({
    data: {
      versionId: pricingVersion.id,
      changedByUserId: systemUser.id,
      changeSummary: 'Initial pricing matrix version created',
      afterState: initialPricingMatrix,
    },
  });

  console.log('Pricing Matrix v1 created and activated\n');

  console.log('Seeding completed successfully!');
  console.log(`Pricing Matrix Version: ${pricingVersion.versionNumber}`);
  console.log(`Created by: ${systemUser.name} (${systemUser.email})`);
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
