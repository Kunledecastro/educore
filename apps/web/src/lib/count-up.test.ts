import { describe, expect, it } from "vitest";
import { countFrames, parseCount } from "./count-up";

describe("count-up", () => {
  it("finds the number and keeps the words around it", () => {
    expect(parseCount("30 days")).toEqual({ before: "", after: " days", target: 30, grouped: false });
    expect(parseCount("from ₦1,500")).toEqual({ before: "from ₦", after: "", target: 1500, grouped: true });
  });

  it("leaves text with no number, or a 1, alone", () => {
    expect(parseCount("Per pupil")).toBeNull();
    expect(parseCount("1 tap")).toBeNull();
  });

  it("counts up and always ends on the original text", () => {
    const frames = countFrames(parseCount("from ₦1,500")!, 40);
    expect(frames).toHaveLength(40);
    expect(frames.at(-1)).toBe("from ₦1,500");
    const values = frames.map((f) => Number(f.replace(/\D/g, "")));
    expect(values.every((v, i) => i === 0 || v >= values[i - 1]!)).toBe(true);
    expect(values[0]).toBeLessThan(1500);
  });
});
