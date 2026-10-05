import { createHash } from "node:crypto";
import { platformPrisma, recordAudit, type Prisma } from "@educore/db";
import { checkLogo, detectLogoType, logoUrl, normaliseHex, parseBranding, type Branding, type LogoProblem } from "./branding";

/**
 * School branding, database side. Tenant.branding and the logo are
 * platform-level rows, so they're written with the platform client — but only
 * ever for the school the caller already proved they administer (the server
 * action checks `branding:update` and passes the session's school). Every
 * change goes in the school's audit log.
 */

export interface BrandingActor {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatorId?: string | null;
}

export class BrandingError extends Error {
  constructor(public readonly code: NonNullable<LogoProblem> | "badColor") {
    super(code);
    this.name = "BrandingError";
  }
}

export async function getBranding(tenantId: string): Promise<{ name: string; branding: Branding; logoUrl: string | null } | null> {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { name: true, branding: true } });
  if (!t) return null;
  const branding = parseBranding(t.branding);
  return { name: t.name, branding, logoUrl: logoUrl(tenantId, branding.logoVersion) };
}

async function writeBranding(tenantId: string, actor: BrandingActor, change: (b: Branding) => Branding, extra?: (tx: Prisma.TransactionClient) => Promise<void>) {
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { branding: true } });
    const raw = t.branding && typeof t.branding === "object" ? (t.branding as Record<string, unknown>) : {};
    const before = parseBranding(raw);
    const after = change(before);
    if (extra) await extra(tx);
    // Keep any other keys already stored; replace only ours.
    await tx.tenant.update({ where: { id: tenantId }, data: { branding: { ...raw, ...after } as Prisma.InputJsonValue, logoUrl: logoUrl(tenantId, after.logoVersion) } });
    await recordAudit(
      { tenantId, actorId: actor.userId, ipAddress: actor.ipAddress, userAgent: actor.userAgent, impersonatorId: actor.impersonatorId ?? null },
      { action: "UPDATE", entityType: "Tenant", entityId: tenantId, before: { branding: before }, after: { branding: after } },
      tx,
    );
  });
}

/** Brand colour (null = EduCore's default) and the contact line shown on documents. */
export async function saveBranding(tenantId: string, actor: BrandingActor, input: { primaryColor: string | null; contactLine: string | null }) {
  const color = input.primaryColor === null ? null : normaliseHex(input.primaryColor);
  if (input.primaryColor !== null && !color) throw new BrandingError("badColor");
  const contact = input.contactLine?.trim().slice(0, 200) || null;
  await writeBranding(tenantId, actor, (b) => ({ ...b, primaryColor: color, contactLine: contact }));
}

export async function saveLogo(tenantId: string, actor: BrandingActor, bytes: Uint8Array) {
  const problem = checkLogo(bytes);
  if (problem) throw new BrandingError(problem);
  const contentType = detectLogoType(bytes)!;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const data = Buffer.from(bytes);
  await writeBranding(
    tenantId,
    actor,
    (b) => ({ ...b, logoVersion: sha256.slice(0, 16) }),
    async (tx) => {
      const row = { data, contentType, sizeBytes: data.length, sha256, updatedById: actor.userId };
      await tx.tenantLogo.upsert({ where: { tenantId }, create: { tenantId, ...row }, update: row });
    },
  );
  return { logoUrl: logoUrl(tenantId, sha256.slice(0, 16)) };
}

export async function removeLogo(tenantId: string, actor: BrandingActor) {
  await writeBranding(
    tenantId,
    actor,
    (b) => ({ ...b, logoVersion: null }),
    async (tx) => {
      await tx.tenantLogo.deleteMany({ where: { tenantId } });
    },
  );
}

/** The logo bytes, for the public logo route and for PDFs. */
export async function loadLogo(tenantId: string): Promise<{ data: Buffer; contentType: "image/png" | "image/jpeg"; sha256: string } | null> {
  const row = await platformPrisma().tenantLogo.findUnique({ where: { tenantId }, select: { data: true, contentType: true, sha256: true } });
  if (!row) return null;
  return { data: Buffer.from(row.data), contentType: row.contentType === "image/png" ? "image/png" : "image/jpeg", sha256: row.sha256 };
}

/** What documents (invoices, receipts, report cards) show of a school's branding. */
export interface DocBranding {
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  color: string | null;
  contactLine: string | null;
}

export async function loadDocBranding(tenantId: string): Promise<DocBranding> {
  const [t, logo] = await Promise.all([platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { branding: true } }), loadLogo(tenantId)]);
  const b = parseBranding(t?.branding);
  return { logo: logo ? { data: logo.data, format: logo.contentType === "image/png" ? "png" : "jpg" } : null, color: b.primaryColor, contactLine: b.contactLine };
}
