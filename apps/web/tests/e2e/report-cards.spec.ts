import { test, expect, type Page } from "@playwright/test";

// Phase 2.3 smoke: form teacher writes comments for their section only; admins see generate controls.
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill("Passw0rd!23");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test.describe("report cards", () => {
  test("form teacher opens their section and sees the comments editor", async ({ page }) => {
    await signIn(page, "c.eze@greenfield.edu");
    await page.goto("/report-cards");
    await page.getByRole("link", { name: /open: grade 5 a/i }).click();
    await expect(page.getByRole("heading", { name: /report cards · grade 5 a/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /save comments/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate report cards/i })).toHaveCount(0);
  });

  test("a teacher who isn't form teacher can't open the section", async ({ page }) => {
    await signIn(page, "f.bello@greenfield.edu");
    const res = await page.goto("/report-cards/sec_grade5a");
    expect(res?.status()).toBe(404);
  });

  test("admin sees the generate control", async ({ page }) => {
    await signIn(page, "admin@greenfield.edu");
    await page.goto("/report-cards/sec_grade5a");
    await expect(page.getByRole("button", { name: /generate report cards|regenerate report cards/i })).toBeVisible();
  });
});
