import { NextResponse, type NextRequest } from "next/server";
import { can } from "@educore/auth";
import { loadReceiptDoc } from "@/lib/fee-docs";
import { renderReceiptPdf } from "@/lib/fee-pdf";
import { ForbiddenError, assertEntitled, requireUser, UnauthenticatedError } from "@/lib/guard";
import { fileSlug } from "@/lib/report-card-pdf";
import { studentScopeFor } from "@/lib/student-scope";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/receipts/{paymentId} — a payment receipt as a PDF. Same row scope as the
 * invoice page (a parent only reaches their own children's receipts);
 * anything not allowed answers 404 so other families' ids reveal nothing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !can(ctx.user.role, "payment", "read")) throw new ForbiddenError();
    await assertEntitled(ctx, "payment", "read");
    const id = idSchema.safeParse(params.id);
    if (!id.success) return notFound();
    const doc = await loadReceiptDoc(ctx.db, ctx.user.tenantId!, id.data, await studentScopeFor(ctx));
    if (!doc) return notFound();
    const pdf = await renderReceiptPdf(doc);
    return new NextResponse(new Uint8Array(pdf) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileSlug(doc.receiptNo)}-${fileSlug(doc.student.name)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[receipt-pdf] failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
