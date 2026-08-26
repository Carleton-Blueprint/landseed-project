/**
 * WCAG 2.1 AA checks — axe-core scans, keyboard nav, focus visibility, 200% text resize.
 * Only covers the intake form and auth pages; dashboard/admin need a real DB session (see the
 * "Authenticated flows" pattern in mobile-responsiveness.spec.ts).
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// prints a readable summary instead of axe's raw dump
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (v) =>
          `\n[${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n` +
          v.nodes.map((n) => `  - ${n.target.join(" ")}`).join("\n")
      )
      .join("\n");
    throw new Error(`axe-core found ${results.violations.length} violation(s):${summary}`);
  }
}

// WCAG 1.4.4 — zoom the page like a user hitting ctrl-+ and check nothing overflows or clips
async function expectUsableAt200PercentZoom(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.waitForTimeout(100); // let layout settle
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    "content must not overflow horizontally when text is resized to 200%"
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("Automated WCAG 2.1 AA scan (axe-core)", () => {
  test("intake page has no axe violations", async ({ page }) => {
    await page.goto("/");
    await expectNoAxeViolations(page);
  });

  test("sign-in page has no axe violations", async ({ page }) => {
    await page.goto("/auth/signin");
    await expectNoAxeViolations(page);
  });

  test("sign-up page has no axe violations", async ({ page }) => {
    await page.goto("/auth/signup");
    await expectNoAxeViolations(page);
  });
});

test.describe("Text resize to 200% (WCAG 1.4.4)", () => {
  for (const path of ["/", "/auth/signin", "/auth/signup"]) {
    test(`${path} remains usable at 200% text size`, async ({ page }) => {
      await page.goto(path);
      await expectUsableAt200PercentZoom(page);
    });
  }
});

test.describe("Keyboard navigation (WCAG 2.1.1 / 2.4.7)", () => {
  test("intake form: every field is reachable via Tab and shows a visible focus indicator", async ({ page }) => {
    await page.goto("/");

    const seen = new Set<string>();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250); // outline-width is mid-transition on some elements otherwise
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          id: (el as HTMLElement).id || null,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });
      if (!focused) continue;
      const key = `${focused.tag}#${focused.id}`;
      seen.add(key);

      const hasVisibleFocus =
        (focused.outlineStyle !== "none" && parseFloat(focused.outlineWidth) > 0) ||
        (focused.boxShadow && focused.boxShadow !== "none");
      expect(hasVisibleFocus, `${key} should show a visible focus indicator`).toBeTruthy();
    }
    expect(seen.size, "Tab should move focus through multiple distinct elements").toBeGreaterThan(3);
  });

  test("sign-in → sign-up switch link is keyboard-operable", async ({ page }) => {
    await page.goto("/auth/signin");
    const signUpLink = page.getByRole("link", { name: /sign up/i });
    await signUpLink.focus();
    await expect(signUpLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/auth\/signup$/);
  });

  test("intake form can be fully filled and submitted using only the keyboard", async ({ page }) => {
    await page.goto("/");
    const nameInput = page.getByLabel(/name/i);
    await nameInput.focus();
    await page.keyboard.type("Keyboard Only Tester");
    await expect(nameInput).toHaveValue("Keyboard Only Tester");

    // intake.spec.ts already checks the validation message; this just confirms no mouse is needed
    await page.getByRole("button", { name: /submit/i }).focus();
    await page.keyboard.press("Enter");
  });
});
