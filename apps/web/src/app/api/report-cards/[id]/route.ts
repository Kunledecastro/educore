import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { ForbiddenError, assertEntitled, requireUser, UnauthenticatedError } from "@/lib/guard";
import { cardState, parseSnapshot } from "@/lib/report-card";
import { fileSlug, renderReportCards } from "@/lib/report-card-pdf";
import { studentScopeFor } from "@/lib/student-scope";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report-cards/{id} — one student's report card as a PDF.
 *
 * Same row scope as the student's profile (a parent only reaches their own
 * child; a teacher only students in their sections), and families only
 * once the class's results for that term are published. Anything not
 * allowed answers 404, so ids from other families or schools reveal nothing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !can(ctx.user.role, "reportCard", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "reportCard", "read");
    const id = idSchema.safeParse(params.id);
    if (!id.success) return notFound();

    const scope = await studentScopeFor(ctx);
    const card = await ctx.db.reportCard.findFirst({
      where: { id: id.data, student: scope },
      include: { student: { select: { classId: true, firstName: true, lastName: true } }, term: { select: { name: true } } },
    });
    if (!card || cardState(card) === "notGenerated") return notFound();
    const snapshot = parseSnapshot(card.snapshot)!;

    const family = ctx.user.role === Role.PARENT || ctx.user.role === Role.STUDENT;
    if (family) {
      const published = card.student.classId
        ? await ctx.db.resultPublication.findFirst({ where: { termId: card.termId, classId: card.student.classId } })
        : null;
      if (!published) return notFound();
    }

    const pdf = await renderReportCards([snapshot], `${snapshot.student.name} · ${snapshot.period.term}`);
    const name = `report-card-${fileSlug(`${card.student.firstName} ${card.student.lastName}`)}-${fileSlug(card.term.name)}.pdf`;
    return new NextResponse(new Uint8Array(pdf) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[report-card] download failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
