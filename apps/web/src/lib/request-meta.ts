import { isIP } from "node:net";

/**
 * Client IP for audit logs and rate limiting. On Vercel the platform sets
 * `x-real-ip` / `x-forwarded-for` itself (client-supplied values are
 * overwritten at the edge), so the first forwarded address is the caller.
 * Anything that isn't a valid IP is dropped rather than stored.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return null;
}

/** User agent, truncated so a hostile header can't bloat the audit table. */
export function userAgentFromHeaders(headers: Headers): string | null {
  const ua = headers.get("user-agent")?.trim();
  return ua ? ua.slice(0, 512) : null;
}

/** The request's host if it's ours (a root domain or a school subdomain of one), else the first root domain. */
export function trustedHost(host: string | null): string {
  const roots = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  const h = (host ?? "").toLowerCase();
  const ok = roots.some((root) => h === root || h.endsWith(`.${root}`));
  return ok ? h : roots[0]!;
}
