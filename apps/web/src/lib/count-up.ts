/**
 * Count-up text for the public site's number cards ("30 days", "from ₦1,500").
 * Pure, so it can be unit-tested; the browser side is in
 * components/marketing/motion.tsx.
 */

export interface ParsedCount {
  before: string;
  after: string;
  target: number;
  /** The original used thousands separators ("1,500"). */
  grouped: boolean;
}

/** The first whole number in the text, with what comes before and after it. Null if there is none (or it's too small to bother animating). */
export function parseCount(text: string): ParsedCount | null {
  const m = /\d[\d,]*/.exec(text);
  if (!m) return null;
  const target = Number(m[0].replace(/,/g, ""));
  if (!Number.isFinite(target) || target < 2) return null;
  return { before: text.slice(0, m.index), after: text.slice(m.index + m[0].length), target, grouped: m[0].includes(",") };
}

/** Text for each animation frame, easing out, ending exactly on the original number. */
export function countFrames(p: ParsedCount, frames: number): string[] {
  const n = Math.max(2, Math.floor(frames));
  const fmt = (v: number) => (p.grouped ? v.toLocaleString("en-NG") : String(v));
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const eased = 1 - Math.pow(1 - t, 3);
    out.push(`${p.before}${fmt(Math.round(p.target * eased))}${p.after}`);
  }
  return out;
}
