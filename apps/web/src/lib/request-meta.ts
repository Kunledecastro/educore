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
