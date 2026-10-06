import { describe, expect, it } from "vitest";
import { fitWithin } from "./image-shrink";

describe("fitWithin", () => {
  it("shrinks the long side to 1600 px, keeping the shape, never enlarging", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1)).toEqual({ width: 1600, height: 1 });
  });
});
