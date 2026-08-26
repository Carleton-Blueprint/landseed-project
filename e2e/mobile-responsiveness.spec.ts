/**
 * Mobile checks for iOS 14+ / Android 10+. Runs across every project in playwright.config.ts —
 * WebKit stands in for Safari, mobile-Chromium for Android Chrome. Neither is the real thing, so
 * a pass here means "no regression under emulation," not "verified on a physical device."
 */
import { test, expect, type Page } from "@playwright/test";

// #1 mobile layout bug: something pushes past the viewport edge and the whole page scrolls sideways.
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page content should not overflow the viewport width").toBeLessThanOrEqual(
    clientWidth + 1 // sub-pixel rounding
  );
}

// iOS zooms in on focus for text-entry controls under 16px. Checkboxes/radios/buttons/files are exempt.
const ZOOM_RELEVANT_TYPES = [
  "text", "email", "tel", "password", "number", "search", "url", "date", "datetime-local", "month", "time", "week",
];

// Only checked below the sm: breakpoint — above 640px we intentionally drop to the denser 14px size.
async function expectNoIOSZoomTriggeringInputs(page: Page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 640) return;

  const undersized = await page.evaluate((zoomRelevantTypes: string[]) => {
    const controls = Array.from(document.querySelectorAll("input, select, textarea"));
    return controls
      .filter((el) => {
        if (el instanceof HTMLInputElement && !zoomRelevantTypes.includes(el.type)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0; // only visible controls
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || null,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((el) => el.fontSize < 16);
  }, ZOOM_RELEVANT_TYPES);
  expect(undersized, "no visible form control should render below 16px on mobile").toEqual([]);
}

test.describe("Viewport meta", () => {
  test("root layout declares an explicit, zoom-friendly viewport", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
    // Pinch-zoom must stay enabled for accessibility (WCAG 1.4.4).
    expect(content).not.toMatch(/maximum-scale=1(\.0)?\b/);
    expect(content).not.toMatch(/user-scalable=no/);
  });
});

test.describe("Intake flow — mobile layout", () => {
  test("renders without horizontal overflow and inputs are zoom-safe", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("form", { name: /digital intake form/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoIOSZoomTriggeringInputs(page);
  });

  test("name field is tappable and typeable on a touch viewport", async ({ page }) => {
    await page.goto("/");
    const nameInput = page.getByLabel(/name/i);
    await nameInput.click();
    await nameInput.fill("Mobile QA Tester");
    await expect(nameInput).toHaveValue("Mobile QA Tester");
  });
});

test.describe("Auth pages — mobile layout", () => {
  test("sign-in page: correct keyboard types, no overflow, links to sign-up", async ({ page }) => {
    await page.goto("/auth/signin");
    await expectNoHorizontalOverflow(page);
    await expectNoIOSZoomTriggeringInputs(page);

    // determines which on-screen keyboard mobile browsers show
    await expect(page.locator("#email")).toHaveAttribute("type", "email");

    await page.getByRole("link", { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/auth\/signup$/);
  });

  test("sign-up page: correct keyboard types, no overflow, links back to sign-in", async ({ page }) => {
    await page.goto("/auth/signup");
    await expectNoHorizontalOverflow(page);
    await expectNoIOSZoomTriggeringInputs(page);

    await expect(page.locator("#email")).toHaveAttribute("type", "email");
    await expect(page.locator("#phone")).toHaveAttribute("type", "tel");

    await page.getByRole("link", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/signin$/);
  });
});

// Needs a real DATABASE_URL + a seeded account — skipped until E2E_TEST_USER_EMAIL/PASSWORD are set.
test.describe("Authenticated flows — dashboard / estimate review", () => {
  test.skip(
    !process.env.E2E_TEST_USER_EMAIL || !process.env.E2E_TEST_USER_PASSWORD,
    "requires E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD for a seeded account with a real project + quote"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/signin");
    await page.locator("#email").fill(process.env.E2E_TEST_USER_EMAIL!);
    await page.locator("#password").fill(process.env.E2E_TEST_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("dashboard renders without horizontal overflow", async ({ page }) => {
    await expectNoHorizontalOverflow(page);
  });

  test("first project's estimate-review page renders without horizontal overflow", async ({ page }) => {
    const firstProjectLink = page.locator('a[href^="/projects/"][href*="/estimate"]').first();
    await firstProjectLink.click();
    await expectNoHorizontalOverflow(page);
  });
});
