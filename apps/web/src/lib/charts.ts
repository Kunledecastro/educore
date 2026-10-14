/**
 * Small chart maths (Phase 9): our own SVG charts, no chart library, so
 * pages stay light on mobile data. Pure and unit-tested.
 */

/** A "nice" axis from min to max with about `count` ticks (1, 2, 2.5 or 5 × 10ⁿ steps). */
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: lo, max: hi, step, ticks };
}

export interface Plotted {
  x: number;
  y: number;
}

/** Points spread evenly across `width`, values mapped into `height` (SVG y grows downwards). */
export function plot(values: readonly number[], width: number, height: number, domain: { min: number; max: number }, pad = 0): Plotted[] {
  const n = values.length;
  const span = domain.max - domain.min || 1;
  return values.map((v, i) => ({
    x: n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1),
    y: height - ((Math.min(domain.max, Math.max(domain.min, v)) - domain.min) / span) * height,
  }));
}

const f = (n: number) => Number(n.toFixed(2));

/** The line through the points, and the same line closed down to the baseline for a soft fill. */
export function linePaths(points: readonly Plotted[], height: number): { line: string; area: string } {
  if (points.length === 0) return { line: "", area: "" };
  const line = points.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join(" ");
  const area = `${line} L${f(points[points.length - 1]!.x)} ${height} L${f(points[0]!.x)} ${height} Z`;
  return { line, area };
}

/** 0–100 for a progress bar, safe for zero or missing totals. */
export function percent(value: number, total: number): number {
  if (!total || total <= 0 || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}
