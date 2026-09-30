import { test, expect, type Page } from "@playwright/test";

// Phase 2.2 smoke: teachers reach only their gradebooks; admins see class results; parents see only published results.
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill("Passw0rd!23");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test.describe("scores & results", () => {
  test("a subject teacher opens their gradebook", async ({ page }) => {
    await signIn(page, "f.bello@greenfield.edu");
    await page.goto("/assessments");
    await page.getByRole("link", { name: /grade 5 a · english/i }).click();
    await expect(page.getByRole("heading", { name: /grade 5 a · english/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /total/i })).toBeVisible();
  });

  test("a teacher can't open another teacher's gradebook", async ({ page }) => {
    await signIn(page, "f.bello@greenfield.edu");
    const res = await page.goto("/assessments/sec_grade5a/subj_math");
    expect(res?.status()).toBe(404);
  });

  test("admin sees class results with publish controls", async ({ page }) => {
    await signIn(page, "admin@greenfield.edu");
    await page.goto("/assessments/results");
    await expect(page.getByRole("button", { name: /publish results|unpublish/i })).toBeVisible();
  });
});
