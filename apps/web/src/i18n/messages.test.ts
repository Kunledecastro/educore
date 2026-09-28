import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("translations", () => {
  it("French has exactly the same keys as English (no missing or stale strings)", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it("every placeholder in English also appears in the French string", () => {
    const flat = (o: Record<string, unknown>) =>
      Object.fromEntries(keys(o).map((k) => [k, k.split(".").reduce<any>((a, p) => a[p], o)]));
    const e = flat(en);
    const f = flat(fr);
    for (const [k, v] of Object.entries(e)) {
      const vars = String(v).match(/\{\w+\}/g) ?? [];
      for (const variable of vars) expect(String(f[k]), `${k} is missing ${variable}`).toContain(variable);
    }
  });
});
