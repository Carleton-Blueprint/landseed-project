/**
 * Seed script to initialize pricing matrix and grant rules versions.
 * Run this after applying the migration to set up initial versions.
 * 
 * Usage: npx tsx prisma/seed-versions.ts
 * Run: npm run db:seed-versions 
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding initial pricing matrix and grant rules versions...\n');

  // Check if versions already exist
  const existingPricing = await prisma.pricingMatrixVersion.count();
  const existingGrant = await prisma.grantRulesVersion.count();

  if (existingPricing > 0 || existingGrant > 0) {
    console.log('⚠️  Versions already exist. Skipping seed to prevent duplicates.');
    console.log(`   Pricing Matrix Versions: ${existingPricing}`);
    console.log(`   Grant Rules Versions: ${existingGrant}\n`);
    return;
  }

  // Get or create a system user for initial versions
  let systemUser = await prisma.user.findFirst({
    where: { email: 'system@landseed.com' },
  });

  if (!systemUser) {
    console.log('📝 Creating system user for initial versions...');
    systemUser = await prisma.user.create({
      data: {
        email: 'system@landseed.com',
        name: 'System',
      },
    });
    console.log('✅ System user created\n');
  }

  // Initial Pricing Matrix
  console.log('💰 Creating initial pricing matrix version...');
  const initialPricingMatrix = {
    version: '1.0.0',
    description: 'Initial pricing matrix for standard home repairs',
    categories: {
      labor: {
        baseRate: 75, // per hour
        skilledRate: 125, // per hour for specialized work
      },
      materials: {
        paint: {
          interior: 35, // per gallon
          exterior: 45, // per gallon
        },
        lumber: {
          standard: 8, // per board foot
          treated: 12, // per board foot
        },
        roofing: {
          shingles: 95, // per square (100 sq ft)
          flashing: 25, // per linear foot
        },
        flooring: {
          vinyl: 3.5, // per sq ft
          hardwood: 8, // per sq ft
          tile: 6, // per sq ft
        },
      },
      markups: {
        materialMarkup: 1.15, // 15% markup on materials
        contingency: 0.10, // 10% contingency
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

  console.log('✅ Pricing Matrix v1 created and activated\n');

  // Initial Grant Rules
  console.log('🎁 Creating initial grant rules version...');
  const initialGrantRules = {
    version: '1.0.0',
    description: 'Initial grant eligibility and calculation rules',
    eligibility: {
      maxHouseholdIncome: 80000, // Annual household income limit
      minCreditScore: 580, // Minimum credit score
      ownerOccupied: true, // Must be owner-occupied
      primaryResidence: true, // Must be primary residence
    },
    grants: {
      basic: {
        name: 'Basic Home Repair Grant',
        maxAmount: 10000,
        matchRequired: false,
        coveragePercentage: 80, // Covers 80% of eligible costs
      },
      energy: {
        name: 'Energy Efficiency Grant',
        maxAmount: 15000,
        matchRequired: false,
        coveragePercentage: 90, // Covers 90% of eligible costs
        eligibleImprovements: [
          'insulation',
          'windows',
          'hvac',
          'solar panels',
          'water heater',
        ],
      },
      emergency: {
        name: 'Emergency Repair Grant',
        maxAmount: 25000,
        matchRequired: false,
        coveragePercentage: 100, // Covers 100% of eligible costs
        eligibleEmergencies: [
          'roof damage',
          'foundation issues',
          'electrical hazards',
          'plumbing failures',
          'structural damage',
        ],
      },
    },
    income_tiers: {
      tier1: {
        maxIncome: 30000,
        discountPercentage: 100, // No copay required
      },
      tier2: {
        maxIncome: 50000,
        discountPercentage: 90, // 10% copay
      },
      tier3: {
        maxIncome: 80000,
        discountPercentage: 80, // 20% copay
      },
    },
    effectiveDate: new Date().toISOString(),
  };

  const grantVersion = await prisma.grantRulesVersion.create({
    data: {
      versionNumber: 1,
      rules: initialGrantRules,
      createdByUserId: systemUser.id,
      isActive: true,
    },
  });

  await prisma.grantRulesAuditLog.create({
    data: {
      versionId: grantVersion.id,
      changedByUserId: systemUser.id,
      changeSummary: 'Initial grant rules version created',
      afterState: initialGrantRules,
    },
  });

  console.log('✅ Grant Rules v1 created and activated\n');

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ Seeding completed successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Pricing Matrix Version: ${pricingVersion.versionNumber}`);
  console.log(`📋 Grant Rules Version: ${grantVersion.versionNumber}`);
  console.log(`👤 Created by: ${systemUser.name} (${systemUser.email})`);
  console.log('\n💡 You can now generate quotes using these versions!');
  console.log('\n📝 To customize the pricing and rules, edit this seed file');
  console.log('   and create new versions via the admin API.\n');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
