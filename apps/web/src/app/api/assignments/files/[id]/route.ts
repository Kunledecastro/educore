import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { AssignmentError, assignmentViewer, downloadLink } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { ForbiddenError, assertEntitled, requireUser, UnauthenticatedError } from "@/lib/guard";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments/files/{id} — sends the browser to a five-minute
 * download link for an assignment file, if this person may see it (same
 * rules as the assignment page). Anything else answers 404, so another
 * family's or school's file ids reveal nothing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !ctx.user.tenantId || !can(ctx.user.role, "assignment", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "assignment", "read");
    const id = idSchema.safeParse(params.id);
    if (!id.success) return notFound();
    const viewer = await assignmentViewer(ctx.user.tenantId, { id: ctx.user.id, role: ctx.user.role as AnyRole });
    const url = await downloadLink(viewer, id.data);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof AssignmentError) return err.code === "storageOff" ? NextResponse.json({ error: "File storage is not set up" }, { status: 503 }) : notFound();
    console.error("[assignment-file] failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
