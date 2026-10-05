/**
 * School branding (logo, brand colour, contact line). Pure and unit-tested:
 * colour maths for accessible themes, and image checks for logo uploads.
 *
 * - Any brand colour works: the text on it is white or black, whichever
 *   contrasts more (always ≥ 4.5:1, WCAG AA). In dark mode a dark colour is
 *   lightened so buttons and links stay visible on the dark background.
 * - Logos: PNG or JPEG only (no SVG — it can carry scripts), up to 512 KB,
 *   identified by their bytes, not by the file name or the browser's word.
 */

export const LOGO_MAX_BYTES = 512 * 1024;
export type LogoType = "image/png" | "image/jpeg";

export const BRAND_PRESETS = ["#0f766e", "#1d4ed8", "#7c3aed", "#be123c", "#b45309", "#15803d", "#0e7490", "#1e3a8a", "#86198f", "#374151"] as const;

export interface Branding {
  primaryColor: string | null;
  /** Shown on invoices, receipts and report cards, e.g. "12 Allen Avenue, Ikeja · 0803 000 0000". */
  contactLine: string | null;
  /** Changes when the logo changes (cache-busting for the logo URL). Null = no logo. */
  logoVersion: string | null;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function normaliseHex(input: string): string | null {
  const v = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return HEX.test(v) ? v : null;
}

/** Reads Tenant.branding JSON defensively: anything unexpected becomes "not set". */
export function parseBranding(raw: unknown): Branding {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = typeof o.primaryColor === "string" ? normaliseHex(o.primaryColor) : null;
  const contact = typeof o.contactLine === "string" ? o.contactLine.trim().slice(0, 200) || null : null;
  const version = typeof o.logoVersion === "string" && /^[0-9a-f]{8,64}$/.test(o.logoVersion) ? o.logoVersion : null;
  return { primaryColor: color, contactLine: contact, logoVersion: version };
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = "#ffffff";
const INK = "#000000";

/** White or near-black text on this colour, whichever reads better. */
export function foregroundFor(hex: string): string {
  return contrastRatio(hex, WHITE) >= contrastRatio(hex, INK) ? WHITE : INK;
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function fromHsl(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** "h s% l%" — the format the app's CSS variables use. */
export function hslTriplet(hex: string): string {
  const [h, s, l] = toHsl(rgb(hex));
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

const DARK_BG = "#0b1220";

/** For dark mode: lighten until the colour stands out from the dark background (≥ 3:1). */
export function darkModeVariant(hex: string): string {
  const [h, s, l] = toHsl(rgb(hex));
  let out = hex;
  for (let L = l; contrastRatio(out, DARK_BG) < 3 && L <= 90; L += 2) out = fromHsl(h, s, L);
  return out;
}

/** CSS variables for a brand colour, light and dark. Values are computed numbers only — safe to inline. */
export function brandCss(hex: string): { light: Record<string, string>; dark: Record<string, string> } {
  const dark = darkModeVariant(hex);
  return {
    light: { "--primary": hslTriplet(hex), "--primary-foreground": hslTriplet(foregroundFor(hex)), "--ring": hslTriplet(hex) },
    dark: { "--primary": hslTriplet(dark), "--primary-foreground": hslTriplet(foregroundFor(dark)), "--ring": hslTriplet(dark) },
  };
}

/** What kind of image these bytes are, by their signature. */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export type LogoProblem = "empty" | "tooLarge" | "notImage" | null;

export function checkLogo(bytes: Uint8Array): LogoProblem {
  if (bytes.length === 0) return "empty";
  if (bytes.length > LOGO_MAX_BYTES) return "tooLarge";
  return detectLogoType(bytes) ? null : "notImage";
}

/** The public address of a school's logo, versioned so browsers refetch when it changes. */
export function logoUrl(tenantId: string, version: string | null): string | null {
  return version ? `/api/branding/logo/${encodeURIComponent(tenantId)}?v=${version}` : null;
}
