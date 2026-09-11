import { test, expect } from "@playwright/test";

// Smoke test for the two most important flows in Phase 0: an authenticated
// user reaches a role-aware dashboard, and an unauthenticated visitor is
// bounced to /login rather than seeing tenant data.
test.describe("login + dashboard smoke test", () => {
  test("unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("marketing home renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("school admin can sign in and reach the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email address/i).fill("admin@greenfield.edu");
    await page.getByLabel(/password/i).fill("Passw0rd!23");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/welcome back/i)).toBeVisible();
  });
});
