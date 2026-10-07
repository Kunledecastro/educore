import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { ForbiddenError, assertEntitled, auditContextFor, requireUser, UnauthenticatedError } from "@/lib/guard";
import { emergencyCards } from "@/lib/health/card";
import { renderEmergencyCardsPdf } from "@/lib/health/card-pdf";
import { HealthError, healthViewer } from "@/lib/health/data";
import { fileSlug } from "@/lib/report-card-pdf";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health/card?student={id} | ?section={id} — emergency card(s) as a
 * PDF (Phase 7.1). What each card shows depends on who asks (see
 * lib/health/rules.ts cardLevel); every card is written to the health
 * access log. Anything not allowed answers 404.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !ctx.user.tenantId || !can(ctx.user.role, "healthAlert", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "healthAlert", "read");
    const student = idSchema.safeParse(req.nextUrl.searchParams.get("student"));
    const section = idSchema.safeParse(req.nextUrl.searchParams.get("section"));
    if (!student.success && !section.success) return notFound();
    const a = auditContextFor(ctx);
    const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
    const doc = await emergencyCards(viewer, student.success ? { studentId: student.data } : { sectionId: section.data! }, { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null });
    const pdf = await renderEmergencyCardsPdf(doc);
    return new NextResponse(new Uint8Array(pdf) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="emergency-card-${fileSlug(doc.title || "class")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof HealthError) return err.code === "notConfigured" ? NextResponse.json({ error: "Health records are not set up" }, { status: 503 }) : notFound();
    console.error("[health-card] failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
