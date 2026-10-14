import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 9: every colour pairing in the Harmattan Gold theme passes WCAG AA
 * (4.5:1 for normal text) in light and dark mode. Reads the real tokens
 * from globals.css, so a later tweak can't quietly break contrast.
 */

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*([0-9.]+ [0-9.]+% [0-9.]+%);/g)].map((m) => [m[1]!, m[2]!]));
}

function rgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.split(" ").map((x) => parseFloat(x)) as [number, number, number];
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
function luminance(hsl: string): number {
  return rgb(hsl)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["card-foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary", "card"],
  ["primary", "background"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["destructive", "card"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["ink-foreground", "ink"],
];

describe("Harmattan Gold theme contrast (WCAG AA)", () => {
  for (const [mode, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    const tokens = block(selector);
    it(`${mode}: every token is defined`, () => {
      for (const [a, b] of PAIRS) {
        expect(tokens[a], `${mode} --${a}`).toBeDefined();
        expect(tokens[b], `${mode} --${b}`).toBeDefined();
      }
    });
    for (const [fg, bg] of PAIRS) {
      it(`${mode}: --${fg} on --${bg} is at least 4.5:1`, () => {
        expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
