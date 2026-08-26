// Tests live in e2e/, run against localhost:3000 by default — override with E2E_BASE_URL to
// point at a server that's already running, or a deployed preview URL in CI.
//
// chromium doubles as the Edge check (same engine); use channel: "msedge" locally for the real
// binary. webkit is the closest we can get to Safari without a device farm. None of these are
// pinned to older versions — that needs BrowserStack/LambdaTest/Sauce Labs.
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // iPhone sizes still common on iOS 14+
    { name: "iOS Safari (iPhone SE)", use: { ...devices["iPhone SE"] } },
    { name: "iOS Safari (iPhone 12)", use: { ...devices["iPhone 12"] } },
    { name: "iOS Safari (iPhone 14 Pro Max)", use: { ...devices["iPhone 14 Pro Max"] } },
    // Android 10+ device sizes
    { name: "Android Chrome (Pixel 5)", use: { ...devices["Pixel 5"] } },
    { name: "Android Chrome (Galaxy S9+)", use: { ...devices["Galaxy S9+"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
