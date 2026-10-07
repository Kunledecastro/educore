import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { ForbiddenError, assertEntitled, auditContextFor, requireUser, UnauthenticatedError } from "@/lib/guard";
import { documentLink, HealthError, healthViewer } from "@/lib/health/data";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/documents/{id} — sends the browser to a five-minute link
 * for a health document, if this person may open the pupil's record. The
 * opening is logged. Anything else answers 404.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !ctx.user.tenantId || !can(ctx.user.role, "healthRecord", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "healthRecord", "read");
    const id = idSchema.safeParse(params.id);
    if (!id.success) return notFound();
    const a = auditContextFor(ctx);
    const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
    const url = await documentLink(viewer, id.data, { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null });
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof HealthError) return err.code === "storageOff" ? NextResponse.json({ error: "File storage is not set up" }, { status: 503 }) : notFound();
    console.error("[health-document] failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
