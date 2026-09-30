import { test, expect, type Page } from "@playwright/test";

// Phase 2.0 smoke: school settings are reachable by admins only.
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill("Passw0rd!23");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test.describe("school settings", () => {
  test("admin sees terms, grading scale, score components and options", async ({ page }) => {
    await signIn(page, "admin@greenfield.edu");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /school settings/i })).toBeVisible();
    await expect(page.getByText(/current term/i).first()).toBeVisible();

    await page.getByRole("link", { name: /grading scale/i }).click();
    await expect(page.getByText(/how totals will be graded/i)).toBeVisible();

    await page.getByRole("link", { name: /score components/i }).click();
    await expect(page.getByText(/total: 100/i)).toBeVisible();

    await page.getByRole("link", { name: /^options$/i }).click();
    await expect(page.getByLabel(/show position in class/i)).toBeVisible();
  });

  test("teachers don't get school settings", async ({ page }) => {
    await signIn(page, "c.eze@greenfield.edu");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /school settings/i })).toHaveCount(0);
  });
});
