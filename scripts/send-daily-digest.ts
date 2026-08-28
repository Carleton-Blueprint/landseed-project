/**
 * Sends the admin daily digest immediately, outside the scheduled
 * worker:admin-digest run — for manual/ad-hoc triggering.
 *
 * Usage:
 *   npx tsx scripts/send-daily-digest.ts
 */
import 'dotenv/config';
import { sendDailyDigest } from '@/backend/services/adminDigest';
import { prisma } from 'lib/prisma';

async function main() {
  console.log('Sending admin daily digest...');
  await sendDailyDigest(new Date());
  console.log('Admin daily digest sent', { at: new Date().toISOString() });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
