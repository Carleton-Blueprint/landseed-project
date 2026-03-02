/**
 * E2E test for the intake form: home page has main and form, and submitting without name shows
 * validation error. Run with: npm run test:e2e (starts dev server if needed).
 */
import { test, expect } from "@playwright/test";

test.describe("Intake form", () => {
  test("has accessible form and shows validation on submit", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("form", { name: /digital intake form/i })).toBeVisible();

    const nameInput = page.getByLabel(/name/i);
    await expect(nameInput).toBeVisible();
    await nameInput.fill("");

    await page.getByRole("button", { name: /submit/i }).click();

    await expect(page.getByText(/name is required/i)).toBeVisible();
  });
});
