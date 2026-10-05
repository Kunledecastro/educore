import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, slugProblem, suggestSlug } from "./slugs";

describe("school short names", () => {
  it("accepts DNS-safe names", () => {
    for (const ok of ["greenfield", "st-marys", "kings-college-2", "abc", "2nd-avenue"]) expect(slugProblem(ok)).toBeNull();
  });

  it("refuses anything that can't be a subdomain", () => {
    for (const bad of ["ab", "Greenfield", "123", "-school", "school-", "st--marys", "st_marys", "st marys", "ëcole", "a".repeat(31)]) {
      expect(slugProblem(bad)).toBe("format");
    }
  });

  it("refuses names the platform keeps", () => {
    for (const r of ["www", "admin", "api", "billing", "support", "login", "signup", "platform", "educore"]) expect(slugProblem(r)).toBe("reserved");
    expect(RESERVED_SLUGS.has("greenfield")).toBe(false);
  });

  it("suggests a short name from the school's name", () => {
    expect(suggestSlug("St. Mary's College, Ikeja")).toBe("st-marys-college-ikeja");
    expect(suggestSlug("École Sainte-Thérèse")).toBe("ecole-sainte-therese");
    expect(suggestSlug("2nd Avenue Academy")).toBe("2nd-avenue-academy");
    expect(suggestSlug("The International Community School of Abuja")).toBe("the-international-community");
    expect(slugProblem(suggestSlug("The International Community School of Abuja"))).toBeNull();
  });
});
