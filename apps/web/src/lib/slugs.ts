/**
 * School short names (Phase 4.3). The short name becomes the school's
 * subdomain (greenfield.educore.app) once a real domain is set, so it follows
 * DNS label rules and can't take names the platform needs. Pure: used by the
 * sign-up form, the server, and middleware (Edge).
 */

/** Subdomains the platform keeps for itself, or that would mislead users. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www", "app", "admin", "api", "platform", "educore", "edu-core", "mail", "email", "smtp", "imap", "mx",
  "support", "help", "billing", "pay", "payments", "paystack", "status", "login", "signin", "signup", "register",
  "auth", "account", "accounts", "static", "assets", "cdn", "media", "files", "uploads", "docs", "blog", "news",
  "dev", "staging", "stage", "test", "demo", "sandbox", "preview", "beta", "internal", "root", "system", "security",
  "webhook", "webhooks", "inngest", "dashboard", "console", "ftp", "ns1", "ns2", "school", "schools",
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugProblem = "format" | "reserved";

export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_RE.test(slug) || !/[a-z]/.test(slug)) return "format";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

/** "St. Mary's College, Ikeja" → "st-marys-college-ikeja" (a suggestion; the person can change it). */
export function suggestSlug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= SLUG_MAX) return s;
  return s.slice(0, SLUG_MAX).replace(/-[^-]*$/, "") || s.slice(0, SLUG_MAX);
}
