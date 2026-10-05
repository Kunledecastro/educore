import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { BrandingError, getBranding, loadDocBranding, loadLogo, removeLogo, saveBranding, saveLogo } from "./branding-data";

/**
 * School branding against a real Postgres (through migration 0022): colour
 * and contact line saved and audited, logos checked by their bytes, stored per
 * school, replaced and removed; other branding keys kept; schools' own
 * sessions can't touch the logo table.
 */

const stamp = Date.now();
let A: string;
let B: string;
let admin: string;
const actor = () => ({ userId: admin, ipAddress: "127.0.0.1", userAgent: "test" });
// Smallest valid-looking PNG and JPEG signatures (the server checks bytes, not names).
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 9, 9]);

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Brand A", slug: `brand-a-${stamp}`, subdomain: `brand-a-${stamp}`, branding: { somethingElse: "keep me" } } }),
    prisma.tenant.create({ data: { name: "Brand B", slug: `brand-b-${stamp}`, subdomain: `brand-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  admin = (await prisma.user.create({ data: { tenantId: A, email: `brand-admin-${stamp}@x.test`, name: "Admin", role: "SCHOOL_ADMIN" } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("school branding", () => {
  it("saves a colour and contact line, keeps other settings, and audits it", async () => {
    await saveBranding(A, actor(), { primaryColor: "#1D4ED8", contactLine: "  12 Allen Avenue, Ikeja · 0803 000 0000 " });
    const got = await getBranding(A);
    expect(got?.branding).toMatchObject({ primaryColor: "#1d4ed8", contactLine: "12 Allen Avenue, Ikeja · 0803 000 0000", logoVersion: null });
    expect(((await prisma.tenant.findUniqueOrThrow({ where: { id: A } })).branding as Record<string, unknown>).somethingElse).toBe("keep me");
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Tenant", actorId: admin } })).toBe(1);
    await expect(saveBranding(A, actor(), { primaryColor: "red; background:url(x)", contactLine: null })).rejects.toEqual(new BrandingError("badColor"));
    await saveBranding(A, actor(), { primaryColor: null, contactLine: null });
    expect((await getBranding(A))?.branding).toMatchObject({ primaryColor: null, contactLine: null });
  });

  it("accepts only real PNG/JPEG bytes within the size limit", async () => {
    await expect(saveLogo(A, actor(), new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toEqual(new BrandingError("notImage"));
    await expect(saveLogo(A, actor(), new Uint8Array())).rejects.toEqual(new BrandingError("empty"));
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(png);
    await expect(saveLogo(A, actor(), big)).rejects.toEqual(new BrandingError("tooLarge"));
    expect(await loadLogo(A)).toBeNull();
  });

  it("stores the logo per school, versions its address, replaces and removes it", async () => {
    const first = await saveLogo(A, actor(), png);
    expect(first.logoUrl).toMatch(new RegExp(`^/api/branding/logo/${A}\\?v=[0-9a-f]{16}$`));
    expect((await loadLogo(A))?.contentType).toBe("image/png");
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A } })).logoUrl).toBe(first.logoUrl);

    const second = await saveLogo(A, actor(), jpeg);
    expect(second.logoUrl).not.toBe(first.logoUrl);
    expect((await loadLogo(A))?.contentType).toBe("image/jpeg");
    expect((await loadDocBranding(A)).logo?.format).toBe("jpg");
    expect(await loadLogo(B)).toBeNull(); // another school

    await removeLogo(A, actor());
    expect(await loadLogo(A)).toBeNull();
    expect((await getBranding(A))?.logoUrl).toBeNull();
  });

  it("a school's own session can't read or write logos directly", async () => {
    await saveLogo(A, actor(), png);
    await expect(withRls(A, (tx) => tx.$queryRaw`SELECT count(*) FROM tenant_logos`)).rejects.toThrow(/permission denied/);
    await expect(withRls(B, (tx) => tx.$executeRaw`DELETE FROM tenant_logos WHERE "tenantId" = ${A}`)).rejects.toThrow(/permission denied/);
  });
});
