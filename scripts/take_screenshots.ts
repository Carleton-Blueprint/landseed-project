import { chromium } from "@playwright/test";

async function main() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set desktop viewport size
  await page.setViewportSize({ width: 1280, height: 900 });

  const routes = [
    { name: "my_projects", url: "http://localhost:3000/dashboard" },
    { name: "caregivers", url: "http://localhost:3000/profile/access" },
    { name: "advisor_panel", url: "http://localhost:3000/admin" },
    { name: "profile", url: "http://localhost:3000/profile" },
    { name: "estimate_timeline", url: "http://localhost:3000/projects/dev-project-id/estimate" },
  ];

  for (const r of routes) {
    try {
      console.log(`Navigating to ${r.url}...`);
      await page.goto(r.url, { waitUntil: "networkidle", timeout: 15000 });
      
      // Add a slight delay for animations to finish loading
      await page.waitForTimeout(1000);

      const path = `/Users/diandrainturire/.gemini/antigravity/brain/8c49e1b5-989d-41b3-b456-9e89d3bfdddf/${r.name}.png`;
      console.log(`Taking screenshot for ${r.name} at ${path}...`);
      await page.screenshot({ path, fullPage: true });
    } catch (err) {
      console.error(`Failed to take screenshot for ${r.name}:`, err);
    }
  }

  await browser.close();
  console.log("All screenshots taken successfully!");
}

main().catch(console.error);
