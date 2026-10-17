import { NextResponse, type NextRequest } from "next/server";
import { auditContextFor, requireUser, UnauthenticatedError } from "@/lib/guard";
import { loadDocBranding } from "@/lib/branding-data";
import { getEntitlements } from "@/lib/entitlements-server";
import { canDownloadProfile, PROFILE_DOWNLOAD_LIMIT } from "@/lib/pupil-profile";
import { loadPupilProfile, recordProfileDownload } from "@/lib/pupil-profile-data";
import { renderPupilProfile } from "@/lib/pupil-profile-pdf";
import { getRateLimiter } from "@/lib/rate-limit";
import { fileSlug } from "@/lib/report-card-pdf";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/students/{id}/profile — the pupil profile report as a PDF
 * (Phase 10.0). Same row scope as the pupil's page; each viewer gets only
 * the sections their role and the school's plan allow (lib/pupil-profile.ts).
 * Every download is written to the school's audit log, and downloads are
 * rate-limited per person. Anything not allowed answers 404, so ids from
 * another family or school reveal nothing.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireUser();
    if (ctx.isPlatformAdmin || !ctx.user.tenantId || !canDownloadProfile(ctx.user.role)) return notFound();
    const id = idSchema.safeParse(params.id);
    if (!id.success) return notFound();

    const allowed = await getRateLimiter()
      .hit(`profile-pdf:${ctx.user.id}`, PROFILE_DOWNLOAD_LIMIT.limit, PROFILE_DOWNLOAD_LIMIT.windowMs)
      .then((r) => r.allowed)
      .catch(() => true); // limiter down: fail open, the download is still audited
    if (!allowed) return NextResponse.json({ error: "Too many downloads; try again in a few minutes" }, { status: 429 });

    const entitlements = await getEntitlements(ctx.user.tenantId);
    const profile = await loadPupilProfile(ctx, id.data, { modules: entitlements.modules });
    if (!profile) return notFound();

    const pdf = await renderPupilProfile(profile, await loadDocBranding(ctx.user.tenantId));
    await recordProfileDownload(auditContextFor(ctx), profile);

    return new NextResponse(new Uint8Array(pdf) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pupil-profile-${fileSlug(profile.pupil.name)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    console.error("[pupil-profile] download failed", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
