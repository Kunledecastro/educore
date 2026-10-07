import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { renderExport } from "@/lib/exports";
import { ForbiddenError, assertEntitled, auditContextFor, requireUser, UnauthenticatedError } from "@/lib/guard";
import { HealthError, healthViewer } from "@/lib/health/data";
import { visitReport } from "@/lib/health/visits";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/visits-report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|xlsx —
 * the clinic report as a spreadsheet (Phase 7.2). Counts only: no pupil is
 * named anywhere. The nurse and school admins.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !ctx.user.tenantId || !can(ctx.user.role, "clinicVisit", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "clinicVisit", "read");
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: "Bad dates" }, { status: 400 });
    const a = auditContextFor(ctx);
    const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
    const r = await visitReport(viewer, { from, to });
    const t = await getTranslations("health");
    const rows: (string | number)[][] = [
      [t("reports.total"), t("reports.allVisits"), r.total],
      ...r.byDay.map((x) => [t("reports.byDay"), x.day, x.count]),
      ...r.byClass.map((x) => [t("reports.byClass"), x.label, x.count]),
      ...r.byComplaint.map((x) => [t("reports.byComplaint"), t(`visits.complaints.${x.key}`), x.count]),
      ...r.byOutcome.map((x) => [t("reports.byOutcome"), x.key === "OPEN" ? t("visits.stillHere") : t(`visits.outcomes.${x.key}`), x.count]),
      ...r.byMedicine.map((x) => [t("reports.byMedicine"), x.key === "own" ? t("reports.ownMedicine") : t(`profile.medicines.${x.key}` as never), x.count]),
    ];
    const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
    const file = await renderExport({ sheetName: "Clinic", headers: [t("reports.colGroup"), t("reports.colItem"), t("reports.colCount")], rows }, format);
    return new NextResponse(file.body as BodyInit, {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="clinic-report-${from}-to-${to}.${file.ext}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof HealthError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[clinic-report] failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
