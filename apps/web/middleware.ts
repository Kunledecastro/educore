import { NextRequest, NextResponse } from "next/server";

// Root domains that mean "no tenant subdomain present" (marketing site,
// platform admin panel). Configure via env so preview deployments and the
// production domain both work without a code change.
const ROOT_DOMAINS = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000,educore.app")
  .split(",")
  .map((d) => d.trim().toLowerCase());

const RESERVED_SUBDOMAINS = new Set(["www", "app", "admin", "api"]);

/**
 * Tenant resolution middleware (architecture rule #1). Runs on the Edge
 * runtime, so it deliberately does NOT touch Prisma/Postgres here — it only
 * extracts the subdomain from the Host header and forwards it as a request
 * header. The actual Tenant row lookup (`getCurrentTenant()` in
 * `src/lib/tenant.ts`) happens later, in a Node.js server context, and is
 * cached per-request with React's `cache()`.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0]!.toLowerCase();

  let subdomain: string | null = null;

  const matchesRoot = ROOT_DOMAINS.some((root) => {
    const rootHost = root.split(":")[0];
    return hostname === rootHost;
  });

  if (!matchesRoot) {
    const rootMatch = ROOT_DOMAINS.find((root) => {
      const rootHost = root.split(":")[0]!;
      return hostname.endsWith(`.${rootHost}`);
    });

    if (rootMatch) {
      const rootHost = rootMatch.split(":")[0]!;
      const candidate = hostname.slice(0, -(`.${rootHost}`.length));
      if (candidate && !RESERVED_SUBDOMAINS.has(candidate)) {
        subdomain = candidate;
      }
    } else {
      // Custom domain (e.g. school's own domain mapped via CNAME). Resolved
      // by exact hostname match against Tenant.customDomain further down the
      // request lifecycle — forward the full hostname instead.
      subdomain = null;
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-tenant-custom-domain", hostname);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  const requestHeaders = new Headers(request.headers);
  if (subdomain) {
    requestHeaders.set("x-tenant-subdomain", subdomain);
  }
  requestHeaders.set("x-tenant-host", hostname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next internals so every
     * page/API route can rely on the tenant headers being present.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
