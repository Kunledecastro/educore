import { describe, expect, it } from "vitest";
import { buildListQuery, pageRange, parseListParams } from "./list-params";

const config = {
  sortable: ["name", "admissionNo", "createdAt"] as const,
  defaultSort: "name" as const,
  filters: { status: ["ACTIVE", "INACTIVE"], classId: ["c1", "c2"] },
};

describe("parseListParams", () => {
  it("applies defaults for an empty URL", () => {
    const p = parseListParams({}, config);
    expect(p).toMatchObject({ q: "", sort: "name", dir: "asc", page: 1, pageSize: 25, filters: {}, skip: 0, take: 25 });
  });

  it("reads valid values", () => {
    const p = parseListParams({ q: "  ada ", sort: "admissionNo", dir: "desc", page: "3", size: "10", status: "ACTIVE" }, config);
    expect(p).toMatchObject({ q: "ada", sort: "admissionNo", dir: "desc", page: 3, pageSize: 10, skip: 20, take: 10 });
    expect(p.filters).toEqual({ status: "ACTIVE" });
  });

  it("ignores sort columns that aren't whitelisted (no arbitrary orderBy from the URL)", () => {
    expect(parseListParams({ sort: "passwordHash" }, config).sort).toBe("name");
    expect(parseListParams({ sort: "__proto__" }, config).sort).toBe("name");
  });

  it("ignores filter values that aren't allowed", () => {
    expect(parseListParams({ status: "DELETED", classId: "c3" }, config).filters).toEqual({});
  });

  it("clamps bad pagination input", () => {
    for (const page of ["0", "-5", "abc", "1.5e9x"]) expect(parseListParams({ page }, config).page).toBe(1);
    expect(parseListParams({ page: "999999999" }, config).page).toBe(10_000);
    expect(parseListParams({ size: "5000" }, config).pageSize).toBe(25);
  });

  it("caps search length", () => {
    expect(parseListParams({ q: "x".repeat(500) }, config).q).toHaveLength(100);
  });

  it("takes the first value of repeated params and accepts URLSearchParams", () => {
    expect(parseListParams({ q: ["a", "b"] }, config).q).toBe("a");
    expect(parseListParams(new URLSearchParams("q=zed&dir=desc"), config)).toMatchObject({ q: "zed", dir: "desc" });
  });
});

describe("buildListQuery", () => {
  it("sets and removes keys", () => {
    expect(buildListQuery("q=a&status=ACTIVE", { status: null })).toBe("?q=a");
    expect(buildListQuery("", { q: "ada" })).toBe("?q=ada");
    expect(buildListQuery("q=a", { q: "" })).toBe("");
  });

  it("resets to page 1 when anything but the page changes", () => {
    expect(buildListQuery("q=a&page=4", { q: "b" })).toBe("?q=b");
    expect(buildListQuery("q=a&page=4", { page: 5 })).toBe("?q=a&page=5");
  });
});

describe("pageRange", () => {
  it("computes the visible window", () => {
    expect(pageRange(2, 25, 120)).toEqual({ from: 26, to: 50, pageCount: 5, hasPrev: true, hasNext: true });
    expect(pageRange(5, 25, 120)).toMatchObject({ from: 101, to: 120, hasNext: false });
  });
  it("handles empty lists", () => {
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0, pageCount: 1, hasPrev: false, hasNext: false });
  });
});
