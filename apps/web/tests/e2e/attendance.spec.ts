import { test, expect, type Page } from "@playwright/test";

// Phase 2.1 smoke: a form teacher reaches their section's register; a parent is sent to their child instead.
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill("Passw0rd!23");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test.describe("attendance", () => {
  test("form teacher opens today's register for their section", async ({ page }) => {
    await signIn(page, "c.eze@greenfield.edu");
    await page.goto("/attendance");
    await expect(page.getByRole("heading", { name: /grade 5 a/i })).toBeVisible();
    await page.getByRole("link", { name: /register: grade 5 a/i }).click();
    await expect(page.getByRole("heading", { name: /register · grade 5 a/i })).toBeVisible();
    await expect(page.getByRole("radiogroup").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /mark all present/i })).toBeVisible();
  });

  test("teacher can't open a section they don't teach", async ({ page }) => {
    await signIn(page, "f.bello@greenfield.edu");
    const res = await page.goto("/attendance/sec_grade6a");
    expect(res?.status()).toBe(404);
  });

  test("parent sees attendance on their child's profile, not the registers", async ({ page }) => {
    await signIn(page, "parent@example.com");
    await page.goto("/attendance");
    await expect(page).toHaveURL(/\/students/);
  });
});
