/**
 * Seed script for FR-3.1 grant rules with provincial eligibility variations
 * 
 * Run this after initial seed-versions.ts to add province-specific rules
 * Usage: npx tsx prisma/seed-fr31-rules.ts
 * Or: npm run db:seed-fr31-rules (if package.json has this script)
 * 
 * Creates a v2.0.0 grant rules version with:
 * - CMHC baseline eligibility (all provinces)
 * - Ontario (ON) provincial overlay rules (phase 1)
 * - Eligible modifications
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding FR-3.1 grant rules with provincial variations...\n');

  // Check if system user exists or create it
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
  }

  // V2.0.0: FR-3.1 Grant Rules with Provincial Rules
  console.log('🎁 Creating FR-3.1 grant rules v2.0.0 with provincial variations...');

  const fr31GrantRules = {
    version: '2.0.0',
    description: 'FR-3.1 Eligibility rules with provincial variations',
    phaseOneProvinces: ['ON'],
    effectiveDate: new Date().toISOString(),

    // CMHC Baseline - applies to all provinces
    eligibility: {
      minApplicantAge: 18, // Minimum age
      maxHouseholdIncome: 85000, // Annual household income ceiling (CMHC baseline)
      requireOwnerOccupied: true, // Must be owner-occupied property
    },

    // Eligible modifications for accessibility improvements
    eligibleModifications: [
      'GRAB_BARS',
      'RAISED_TOILET',
      'WALK_IN_SHOWER',
      'WIDENED_DOORWAY',
      'STAIR_LIFT',
      'HANDRAILS',
    ],

    // Provincial overlay rules (phase 1: Ontario only)
    provinces: {
      ON: {
        enabled: true,
        name: 'Ontario',
        description: 'Ontario-specific eligibility rules (Phase 1 rollout)',
        minHouseholdIncome: 25000, // Floor above which grants apply
        minPropertyAge: 5, // Property must be at least 5 years old
        maxPropertyAge: null, // No upper bound
        eligibleModifications: [
          'GRAB_BARS',
          'RAISED_TOILET',
          'WALK_IN_SHOWER',
          'WIDENED_DOORWAY',
          'STAIR_LIFT',
          'HANDRAILS',
        ],
        grantLimits: {
          maxAmount: 25000, // Max grant per project
          maxPerModification: 5000,
        },
      },

      // Future provinces (disabled by default)
      BC: {
        enabled: false,
        name: 'British Columbia',
        description: 'Coming soon (Phase 2)',
        minHouseholdIncome: 30000,
        minPropertyAge: 3,
        maxPropertyAge: null,
        eligibleModifications: [],
        grantLimits: {
          maxAmount: 20000,
          maxPerModification: 4000,
        },
      },

      AB: {
        enabled: false,
        name: 'Alberta',
        description: 'Coming soon (Phase 2)',
        minHouseholdIncome: 28000,
        minPropertyAge: 4,
        maxPropertyAge: null,
        eligibleModifications: [],
        grantLimits: {
          maxAmount: 22000,
          maxPerModification: 4500,
        },
      },

      MB: {
        enabled: false,
        name: 'Manitoba',
        description: 'Coming soon (Phase 2)',
        minHouseholdIncome: 26000,
        minPropertyAge: 5,
        maxPropertyAge: null,
        eligibleModifications: [],
        grantLimits: {
          maxAmount: 23000,
          maxPerModification: 4000,
        },
      },
    },

    // Staff guidance for manual reviews
    staffGuidance: {
      ELIGIBLE:
        'Client meets all requirements. Proceed with quote generation.',
      INELIGIBLE:
        'Client does not meet core eligibility criteria. Consider decline or escalation.',
      NEEDS_MORE_INFO:
        'Missing required information. Contact client to complete application.',
      MANUAL_REVIEW:
        'Province not yet supported for automated evaluation. Manual review required.',
    },

    // Client messaging (simplified, non-technical)
    clientMessaging: {
      ELIGIBLE:
        'Great news! You appear to be eligible for this home accessibility grant.',
      INELIGIBLE:
        'Unfortunately, you do not currently meet the eligibility requirements.',
      NEEDS_MORE_INFO: 'We need a few more details to determine your eligibility.',
      MANUAL_REVIEW:
        'Your application requires manual review. A staff member will contact you.',
    },
  };

  const grantVersion2 = await prisma.grantRulesVersion.create({
    data: {
      versionNumber: 2,
      rules: fr31GrantRules,
      createdByUserId: systemUser.id,
      isActive: true, // Activate immediately on seed
    },
  });

  await prisma.grantRulesAuditLog.create({
    data: {
      versionId: grantVersion2.id,
      changedByUserId: systemUser.id,
      changeSummary:
        'FR-3.1 grant rules v2.0.0 created with provincial variations and eligibility rules',
      afterState: fr31GrantRules,
    },
  });

  console.log('✅ Grant Rules v2.0.0 created and activated\n');

  // Display info
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ FR-3.1 Grant Rules Seeding Completed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📊 Grant Rules Version Details:');
  console.log(`   Version: ${grantVersion2.versionNumber}`);
  console.log(`   Status: Active (Eligible for evaluation)`);
  console.log(`\n🌍 Phase 1 Provinces (Automated Evaluation):`);
  console.log(`   • Ontario (ON)`);
  console.log(`\n📋 Phase 2 Provinces (Coming Soon - Manual Review):`);
  console.log(
    `   • British Columbia (BC), Alberta (AB), Manitoba (MB), and others`
  );
  console.log(`\n♿ Eligible Modifications:`);
  console.log(`   • Grab bars`);
  console.log(`   • Raised toilet seats`);
  console.log(`   • Walk-in showers`);
  console.log(`   • Widened doorways`);
  console.log(`   • Stair lifts`);
  console.log(`   • Handrails`);
  console.log('\n💡 Key Features:');
  console.log(
    `   • Deterministic eligibility evaluation based on CMHC baseline`
  );
  console.log(`   • Provincial overlay rules for Ontario`);
  console.log(`   • Automatic re-evaluation on rule version changes`);
  console.log(`   • Staff vs. client message differentiation`);
  console.log(`   • Full audit trail for compliance`);
  console.log('\n📝 To test evaluation:`);
  console.log(
    `   POST /api/eligibility/assess with projectId to trigger evaluation`
  );
  console.log(`   GET /api/eligibility/[projectId] to retrieve assessment\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error during FR-3.1 seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
