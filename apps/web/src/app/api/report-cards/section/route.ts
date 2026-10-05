import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { ForbiddenError, assertEntitled, requireUser, UnauthenticatedError } from "@/lib/guard";
import { cardState, parseSnapshot, type ReportSnapshot } from "@/lib/report-card";
import { loadReportCardSection } from "@/lib/report-card-data";
import { fileSlug, renderReportCards } from "@/lib/report-card-pdf";
import { loadDocBranding } from "@/lib/branding-data";
import { NotFoundError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report-cards/section?sectionId=&term= — every generated card in a
 * section for a term, as one PDF for printing. Admins, or the section's
 * form teacher; anyone else gets 404.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !can(ctx.user.role, "reportCard", "export")) throw new ForbiddenError();
    await assertEntitled(ctx, "reportCard", "export");
    const sectionId = idSchema.safeParse(req.nextUrl.searchParams.get("sectionId"));
    const termId = idSchema.safeParse(req.nextUrl.searchParams.get("term"));
    if (!sectionId.success || !termId.success) return notFound();
    const section = await loadReportCardSection(ctx, sectionId.data);

    const cards = await ctx.db.reportCard.findMany({
      where: { termId: termId.data, student: { sectionId: section.id, status: "ACTIVE" } },
      include: { student: { select: { lastName: true, firstName: true } }, term: { select: { name: true } } },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    });
    const snapshots = cards.filter((c) => cardState(c) !== "notGenerated").map((c) => parseSnapshot(c.snapshot)) as ReportSnapshot[];
    if (snapshots.length === 0) return notFound();

    const label = `${section.class.name} ${section.name}`;
    const pdf = await renderReportCards(snapshots, `${label} · ${cards[0]!.term.name}`, await loadDocBranding(ctx.user.tenantId!));
    return new NextResponse(new Uint8Array(pdf) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report-cards-${fileSlug(label)}-${fileSlug(cards[0]!.term.name)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof NotFoundError) return notFound();
    console.error("[report-cards] section download failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
