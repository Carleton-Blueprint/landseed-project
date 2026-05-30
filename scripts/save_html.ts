import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  const routes = [
    { name: "my_projects", url: "http://localhost:3000/dashboard" },
    { name: "caregivers", url: "http://localhost:3000/profile/access" },
    { name: "advisor_panel", url: "http://localhost:3000/admin" },
    { name: "profile", url: "http://localhost:3000/profile" },
    { name: "estimate_timeline", url: "http://localhost:3000/projects/dev-project-id/estimate" },
  ];

  const outputDir = "/Users/diandrainturire/Desktop/landseed-project-main/previews";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const r of routes) {
    try {
      console.log(`Navigating to ${r.url}...`);
      await page.goto(r.url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1500); // Wait for Client components to load
      
      const content = await page.content();
      const filePath = path.join(outputDir, `${r.name}.html`);
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`Saved HTML for ${r.name} at ${filePath}`);
    } catch (err) {
      console.error(`Failed to save HTML for ${r.name}:`, err);
    }
  }

  await browser.close();
  console.log("All HTML files saved successfully!");
}

main().catch(console.error);
