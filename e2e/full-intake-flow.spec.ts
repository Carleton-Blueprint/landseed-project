/**
 * Full end-to-end intake flow: account creation -> sign-in -> intake form
 * submission -> photo upload -> (async) virus scan -> (async) estimate
 * generation -> (async) grant eligibility assessment.
 *
 * Requires real backing services, not mocks: Postgres, Redis, ClamAV, S3,
 * and the three async workers actually running as separate processes
 * (`npm run worker:virus-scan`, `npm run worker:ai-jobs`,
 * `npm run worker:estimate-generation`) alongside `npm run dev` — Playwright's
 * webServer config only starts the Next.js app, not the workers, so without
 * them the flow will hang forever waiting for virus scan / estimate
 * generation / grant assessment to complete.
 *
 * Uses the real signup form (/auth/signup) — POSTs to /api/auth/signup, then
 * signs in with the created password.
 *
 * Estimate generation is scheduled as a delayed BullMQ job
 * (ESTIMATE_GENERATION_DELAY_MINUTES, default 15 min); this repo's .env sets
 * it to 1 min for exactly this kind of test. Grant eligibility assessment is
 * queued from inside estimate generation, so it lands shortly after.
 *
 * Run with: npm run test:e2e -- full-intake-flow
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const FIXTURE_PHOTO = path.join(__dirname, "fixtures", "bathroom.jpg");

// Generous enough to cover the ~1 minute delayed estimate-generation job plus
// whatever real virus-scan / photo-analysis / grant-discovery latency follows
// it, without the whole run silently hanging if a worker isn't running.
const ASYNC_STEP_TIMEOUT_MS = 3 * 60 * 1000;
const RELOAD_INTERVAL_MS = 5_000;

/**
 * The dashboard detail page's estimate range is server-rendered, and its
 * grant-discovery section fetches its own state exactly once on mount (no
 * client-side polling) — so a single `expect(locator).toBeVisible({ timeout })`
 * only waits, it never re-checks, and will time out even once the backend
 * state it's waiting on has actually changed. Reload periodically instead.
 */
async function waitForTextByReloading(page: Page, url: string, locate: (page: Page) => Locator, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    await page.goto(url);
    try {
      await expect(locate(page)).toBeVisible({ timeout: RELOAD_INTERVAL_MS });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Timed out waiting for expected content at ${url}`);
}

test.describe("Full intake-to-grant-assessment flow", () => {
  test("account creation through grant eligibility assessment", async ({ page }) => {
    test.setTimeout(2 * ASYNC_STEP_TIMEOUT_MS + 60_000);

    const testEmail = `e2e-full-flow-${Date.now()}@example.com`;
    const testPassword = "E2eTest!2026";

    // --- Account creation + sign-in (real signup form) ---
    await page.goto("/auth/signup");
    await page.getByLabel("Full Name").fill("E2E Test User");
    await page.getByLabel("Email Address").fill(testEmail);
    await page.getByLabel("Phone Number").fill("6135550100");
    await page.getByLabel("Password", { exact: true }).fill(testPassword);
    await page.getByLabel("Confirm Password").fill(testPassword);
    await page.getByRole("button", { name: "Create Client Account" }).click();

    await page.getByRole("button", { name: "Continue to Assessment & Portal" }).click();
    await page.waitForURL("/dashboard");

    // --- Intake form ---
    // <SessionProvider> has no SSR session hydration (see
    // src/frontend/providers/Providers.tsx) — useSession() starts
    // unauthenticated on every navigation and only resolves once the client
    // fetches /api/auth/session. Racing that fetch trips
    // ensureIntakeAccountBeforeAction's unauthenticated branch in
    // IntakeForm.tsx (it would try to register a second, duplicate account),
    // so wait for the session fetch explicitly before interacting.
    const sessionResponse = page.waitForResponse((res) => res.url().includes("/api/auth/session"));
    await page.goto("/");
    await sessionResponse;

    const form = page.getByRole("form", { name: /digital intake form/i });
    await expect(form).toBeVisible();

    await form.getByLabel("Name").fill("E2E Test User");
    await form.getByLabel("Email").fill(testEmail);
    await form.getByLabel("Phone").fill("6135550100");

    await form.getByLabel("Street address").fill("123 Integration Test St");
    await form.getByLabel("City").fill("Ottawa");
    await form.getByLabel("Province").selectOption("ON");
    await form.getByLabel("Postal code").fill("K1A 0B1");

    await form.getByLabel("Ownership").selectOption("owner");

    await form.getByLabel("Grab bars").check();

    await form.locator('input[type="file"]').first().setInputFiles(FIXTURE_PHOTO);
    await expect(form.getByAltText("Saved project photo")).toBeVisible({ timeout: 15_000 });

    await form.getByLabel(/I consent to the collection/i).check();

    await form.getByRole("button", { name: "Submit" }).click();

    // --- Finalize (POST /api/intake-draft/promote -> finalizeIntake) ---
    await page.waitForURL(/\/submitted\?projectId=/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /submission successful/i })).toBeVisible();

    const url = new URL(page.url());
    const projectId = url.searchParams.get("projectId");
    expect(projectId).toBeTruthy();

    // --- Dashboard: wait for the async chain to complete ---
    const dashboardUrl = `/dashboard/${projectId}`;

    // Estimate generation (delayed job -> generateQuote -> live SerpAPI pricing).
    await waitForTextByReloading(
      page,
      dashboardUrl,
      (p) => p.getByText(/\$[\d,.]+\s*[–-]\s*\$[\d,.]+/),
      ASYNC_STEP_TIMEOUT_MS
    );

    // Grant eligibility assessment (queued from inside estimate generation;
    // its section fetches client-side on mount, so each reload above also
    // gives it a fresh chance to find an assessment once one exists). Once
    // discovered grants render, the individual per-grant status badges
    // (e.g. "More Info Needed") repeat the same wording as the overall
    // decision banner, so match the summary count text instead of a decision
    // label — it's unique to the banner.
    await waitForTextByReloading(
      page,
      dashboardUrl,
      (p) => p.locator("#grant-discovery-section").getByText(/\d+ grant programs? evaluated/i),
      ASYNC_STEP_TIMEOUT_MS
    );
  });
});
