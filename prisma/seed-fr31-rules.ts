/**
 * Legacy FR-3.1 grant-rules seed script.
 *
 * Grant rule tables were removed in favor of discovery-based eligibility.
 * This script is kept as a compatibility entry point and now performs no DB writes.
 */

async function main() {
  console.log('Grant-rules version tables are deprecated and have been removed.');
  console.log('FR-3.1 now uses discovery-backed eligibility snapshots.');
  console.log('No seed action is required for this script.');
}

main().catch((e) => {
  console.error('Error running legacy FR-3.1 seed script:', e);
  process.exit(1);
});
