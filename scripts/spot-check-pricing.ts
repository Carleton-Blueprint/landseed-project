/**
 * Live SerpAPI spot-check for common accessibility modification materials.
 * Hits the real getMaterialPrice() pipeline (no mocks) and prints what came back,
 * so pricing data quality can be eyeballed without spinning up the full app.
 *
 * Usage:
 *   npx tsx scripts/spot-check-pricing.ts
 *
 * Requires SERP_API_KEY to be set in .env.
 */
import "dotenv/config";
import { getMaterialPrice } from "@/backend/services/pricing";

const MATERIAL_QUERIES = [
  "grab bars",
  "walk-in shower kit",
  "stair lift",
  "widened doorway kit",
];

async function main() {
  if (!process.env.SERP_API_KEY) {
    console.error("SERP_API_KEY is not set in .env — cannot run a live spot-check.");
    process.exit(1);
  }

  for (const query of MATERIAL_QUERIES) {
    const result = await getMaterialPrice(query);
    console.log(`\nQuery: "${query}"`);
    console.log(`  status: ${result.status}`);
    console.log(`  name:   ${result.name}`);
    console.log(`  price:  ${result.price !== null ? `$${result.price}` : "null"}`);
    console.log(`  store:  ${result.store ?? "null"}`);
    console.log(`  link:   ${result.link ?? "null"}`);
  }
}

main().catch((err) => {
  console.error("Spot-check failed:", err);
  process.exit(1);
});
