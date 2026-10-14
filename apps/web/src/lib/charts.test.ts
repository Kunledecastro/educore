import { describe, expect, it } from "vitest";
import { linePaths, niceScale, percent, plot } from "./charts";

describe("chart maths (Phase 9)", () => {
  it("picks round axis steps that cover the data", () => {
    expect(niceScale(88, 96)).toMatchObject({ min: 88, max: 96, step: 2, ticks: [88, 90, 92, 94, 96] });
    expect(niceScale(0, 26_000_000).step).toBe(10_000_000);
    expect(niceScale(0, 26_000_000).max).toBe(30_000_000);
    const s = niceScale(91.4, 95.2);
    expect(s.min).toBeLessThanOrEqual(91.4);
    expect(s.max).toBeGreaterThanOrEqual(95.2);
  });

  it("copes with flat or missing data", () => {
    expect(niceScale(5, 5).ticks.length).toBeGreaterThan(1);
    expect(niceScale(0, 0).ticks).toContain(0);
    expect(niceScale(Number.NaN, 3)).toEqual({ min: 0, max: 1, step: 1, ticks: [0, 1] });
  });

  it("places points left to right and higher values higher up", () => {
    const pts = plot([0, 50, 100], 200, 100, { min: 0, max: 100 });
    expect(pts).toEqual([{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 200, y: 0 }]);
    expect(plot([7], 200, 100, { min: 0, max: 10 })[0]!.x).toBe(100);
    expect(plot([150], 200, 100, { min: 0, max: 100 })[0]!.y).toBe(0); // clamped
  });

  it("draws a line and a closed area", () => {
    const { line, area } = linePaths([{ x: 0, y: 10 }, { x: 50, y: 5 }], 40);
    expect(line).toBe("M0 10 L50 5");
    expect(area).toBe("M0 10 L50 5 L50 40 L0 40 Z");
    expect(linePaths([], 40)).toEqual({ line: "", area: "" });
  });

  it("percent never divides by zero or overflows", () => {
    expect(percent(18.4, 26)).toBe(71);
    expect(percent(5, 0)).toBe(0);
    expect(percent(30, 20)).toBe(100);
  });
});
