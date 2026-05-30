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

      if (r.name === "estimate_timeline") {
        // 1. Take initial screenshot
        const path = `/Users/diandrainturire/.gemini/antigravity/brain/8c49e1b5-989d-41b3-b456-9e89d3bfdddf/${r.name}.png`;
        console.log(`Taking initial screenshot for ${r.name} at ${path}...`);
        await page.screenshot({ path, fullPage: true });

        // 2. Click Decline Estimate button
        console.log("Clicking Decline Estimate button...");
        await page.click("#decline-estimate-btn", { force: true });
        await page.waitForTimeout(500);

        // 3. Select survey reason
        console.log("Selecting primary reason too_expensive...");
        await page.click("#reason-too_expensive", { force: true });
        await page.waitForTimeout(200);

        // 4. Select satisfaction rating
        console.log("Selecting satisfaction rating 4...");
        await page.click("#satisfaction-4", { force: true });
        await page.waitForTimeout(200);

        // 5. Fill in comment
        console.log("Filling in decline comments...");
        await page.fill("#decline-comments", "The timeline is slightly longer than expected, but the overall presentation is very detailed.");
        await page.waitForTimeout(200);

        // 6. Capture filled survey screenshot
        const surveyPath = `/Users/diandrainturire/.gemini/antigravity/brain/8c49e1b5-989d-41b3-b456-9e89d3bfdddf/decline_survey_filled.png`;
        console.log(`Taking screenshot for filled survey at ${surveyPath}...`);
        await page.screenshot({ path: surveyPath, fullPage: true });

        // 7. Click submit & decline
        console.log("Clicking submit & decline button...");
        await page.click("#submit-decline-btn", { force: true });
        await page.waitForTimeout(3000);

        // 8. Capture submitted banner
        const submittedPath = `/Users/diandrainturire/.gemini/antigravity/brain/8c49e1b5-989d-41b3-b456-9e89d3bfdddf/decline_survey_submitted.png`;
        console.log(`Taking screenshot for submitted decline banner at ${submittedPath}...`);
        await page.screenshot({ path: submittedPath, fullPage: true });
      } else {
        const path = `/Users/diandrainturire/.gemini/antigravity/brain/8c49e1b5-989d-41b3-b456-9e89d3bfdddf/${r.name}.png`;
        console.log(`Taking screenshot for ${r.name} at ${path}...`);
        await page.screenshot({ path, fullPage: true });
      }
    } catch (err) {
      console.error(`Failed to take screenshot for ${r.name}:`, err);
    }
  }

  await browser.close();
  console.log("All screenshots taken successfully!");
}

main().catch(console.error);
