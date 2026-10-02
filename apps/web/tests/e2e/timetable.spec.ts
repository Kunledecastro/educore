import { test, expect, type Page } from "@playwright/test";

// Phase 2.4 smoke: admins edit, teachers see their own week, parents see their child's class.
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/password/i).fill("Passw0rd!23");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test.describe("timetable", () => {
  test("admin sees the editable class timetable", async ({ page }) => {
    await signIn(page, "admin@greenfield.edu");
    await page.goto("/timetable");
    await expect(page.getByRole("table", { name: /weekly timetable for grade 5 a/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /add a lesson|change/i }).first()).toBeVisible();
  });

  test("teacher sees their own week, read-only", async ({ page }) => {
    await signIn(page, "c.eze@greenfield.edu");
    await page.goto("/timetable");
    await expect(page.getByRole("heading", { name: /my timetable/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /add a lesson/i })).toHaveCount(0);
  });

  test("parent sees their child's class timetable", async ({ page }) => {
    await signIn(page, "parent@example.com");
    await page.goto("/timetable");
    await expect(page.getByRole("table", { name: /weekly timetable for/i })).toBeVisible();
  });
});
