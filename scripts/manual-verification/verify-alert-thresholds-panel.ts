/**
 * Manual verification script: drives the "Monitoring Alert Thresholds" admin
 * panel (Rate Limiting and Monitoring/Alerting, Phase 2) end-to-end in a
 * headless browser — sign in, expand the panel, edit a row, disable a row —
 * and screenshots each step.
 *
 * Requires: `npm run dev` already running and ADVISORY_TEAM_EMAILS
 * containing the sign-in email (see .env). NOTE: the sign-in step below
 * predates the dev auth bypass removal and drives the old name/email-only
 * legacy form at /auth/signin, which now just redirects to `/` — it needs
 * to be updated to fill password on the home page's sign-in form before
 * this script works again.
 *
 * Usage: BASE_URL=http://localhost:3001 npx tsx scripts/manual-verification/verify-alert-thresholds-panel.ts
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "aa@email.com";
const SHOT_DIR = process.env.SCREENSHOT_DIR ?? "/tmp/alert-thresholds-panel-shots";

fs.mkdirSync(SHOT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  async function shot(name: string) {
    const file = path.join(SHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("screenshot:", file);
  }

  console.log("nav signin");
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: "networkidle" });
  await shot("01-signin");

  const nameInput = page.locator('input[name="name"], input#name, input[placeholder*="name" i]').first();
  const emailInput = page.locator('input[type="email"], input[name="email"], input#email').first();
  if (await nameInput.count()) await nameInput.fill("Verification Admin");
  await emailInput.fill(ADMIN_EMAIL);

  await page.locator('button[type="submit"]').first().click();
  await page
    .waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 20000 })
    .catch((e) => console.log("waitForURL after signin failed:", e.message));
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log("url after signin:", page.url());

  console.log("nav /admin");
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "networkidle" });
  await shot("02-admin");

  const panelToggle = page.locator('button:has-text("Monitoring Alert Thresholds")').first();
  await panelToggle.click();
  await page.waitForSelector("text=failures per", { timeout: 10000 });
  await shot("03-panel-expanded");

  const rowTexts = (await page.locator("li").allTextContents()).filter((t) =>
    t.includes("failures per")
  );
  console.log("rows:", JSON.stringify(rowTexts, null, 2));

  const firstRow = page.locator("li", { hasText: "failures per" }).first();
  await firstRow.locator('button:has-text("Edit")').click();
  const countInput = firstRow.locator("input").first();
  const windowInput = firstRow.locator("input").nth(1);
  await countInput.fill("42");
  await windowInput.fill("7");
  await firstRow.locator('button:has-text("Save")').click();
  await page.waitForTimeout(1000);
  await shot("04-after-save");
  console.log("first row after save:", await firstRow.textContent());

  const secondRow = page.locator("li", { hasText: "failures per" }).nth(1);
  await secondRow.locator('button:has-text("Disable")').click();
  await page.waitForTimeout(1000);
  await shot("05-after-disable");
  console.log("second row after disable:", await secondRow.textContent());

  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
