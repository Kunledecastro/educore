import { NextResponse, type NextRequest } from "next/server";
import { loadLogo } from "@/lib/branding-data";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/branding/logo/<schoolId>?v=<version> — a school's logo. Public on
 * purpose (it appears on the school's sign-in page and documents). Only PNG
 * or JPEG ever gets stored, and it's served so a browser can't treat it as
 * anything else: exact type, nosniff, and a sandboxing CSP.
 */
export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const id = idSchema.safeParse(params.tenantId);
  if (!id.success) return new NextResponse(null, { status: 404 });
  const logo = await loadLogo(id.data);
  if (!logo) return new NextResponse(null, { status: 404 });
  const etag = `"${logo.sha256.slice(0, 32)}"`;
  const headers = {
    "Content-Type": logo.contentType,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-site",
    ETag: etag,
    // A versioned URL never changes content; an unversioned one is rechecked.
    "Cache-Control": req.nextUrl.searchParams.get("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
  };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(logo.data), { status: 200, headers });
}
