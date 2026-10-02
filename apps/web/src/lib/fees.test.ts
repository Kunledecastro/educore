import { describe, expect, it } from "vitest";
import { compulsoryTotal, computeBill, discountAppliesToTerm, fromMinor, parseScheduleCells, percentOf, toMinor, type DiscountRule, type ScheduleItem } from "./fees";

describe("toMinor / fromMinor (money without floats)", () => {
  it("parses amounts exactly", () => {
    expect(toMinor("1500")).toBe(150000);
    expect(toMinor("1,500.5")).toBe(150050);
    expect(toMinor("1500.50")).toBe(150050);
    expect(toMinor("0.10")).toBe(10);
    expect(toMinor("007.5")).toBe(750);
    expect(toMinor("12.500")).toBe(1250);
    expect(toMinor(150000)).toBe(15000000);
    expect(toMinor({ toString: () => "99.99" })).toBe(9999);
  });

  it("rejects negatives, junk, too many decimals and amounts Decimal(12,2) can't hold", () => {
    for (const bad of ["-5", "abc", "1.234", "", "  ", "1e5", "₦500", "10000000000"]) expect(toMinor(bad), bad).toBeNull();
    expect(toMinor(null)).toBeNull();
    expect(toMinor(Number.NaN)).toBeNull();
    expect(toMinor("9999999999.99")).toBe(999999999999);
  });

  it("round-trips to the database format", () => {
    expect(fromMinor(150050)).toBe("1500.50");
    expect(fromMinor(5)).toBe("0.05");
    expect(fromMinor(0)).toBe("0.00");
    expect(fromMinor(-2500)).toBe("-25.00");
  });

  it("0.10 + 0.20 is exactly 0.30", () => {
    expect(fromMinor(toMinor("0.10")! + toMinor("0.20")!)).toBe("0.30");
  });
});

describe("percentOf", () => {
  it("rounds half up to the nearest kobo", () => {
    expect(percentOf(150000, 10)).toBe(15000);
    expect(percentOf(333, 50)).toBe(167); // 166.5 → 167
    expect(percentOf(1001, 12.5)).toBe(125); // 125.125 → 125
    expect(percentOf(100, 100)).toBe(100);
  });
  it("stays exact on very large bills", () => {
    // 9,999,999,999.99 × 33.33% = 3,332,999,999.9966… → rounds to 3,333,000,000.00
    expect(percentOf(999_999_999_999, 33.33)).toBe(333_300_000_000);
  });
});

const items: ScheduleItem[] = [
  { feeTypeId: "tuition", name: "Tuition", amountMinor: 15000000, isOptional: false, isOneOff: false },
  { feeTypeId: "dev", name: "Development levy", amountMinor: 2000000, isOptional: false, isOneOff: false },
  { feeTypeId: "admission", name: "Admission fee", amountMinor: 5000000, isOptional: false, isOneOff: true },
  { feeTypeId: "bus", name: "School bus", amountMinor: 3000000, isOptional: true, isOneOff: false },
];
const none = new Set<string>();

describe("computeBill", () => {
  it("charges compulsory items, skips optional ones nobody signed up for", () => {
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: none, discounts: [] });
    expect(bill.lines.map((l) => l.description)).toEqual(["Tuition", "Development levy", "Admission fee"]);
    expect(bill.skipped).toEqual([{ feeTypeId: "bus", name: "School bus", reason: "notSignedUp" }]);
    expect(bill.totalMinor).toBe(22000000);
  });

  it("adds optional items the student is signed up for", () => {
    const bill = computeBill({ items, signedUp: new Set(["bus"]), alreadyBilledOneOff: none, discounts: [] });
    expect(bill.subtotalMinor).toBe(25000000);
  });

  it("bills one-off items only once", () => {
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: new Set(["admission"]), discounts: [] });
    expect(bill.lines.some((l) => l.description === "Admission fee")).toBe(false);
    expect(bill.skipped).toContainEqual({ feeTypeId: "admission", name: "Admission fee", reason: "alreadyBilled" });
    expect(bill.totalMinor).toBe(17000000);
  });

  it("ignores items with no amount for this class", () => {
    const bill = computeBill({ items: [{ ...items[0]!, amountMinor: 0 }], signedUp: none, alreadyBilledOneOff: none, discounts: [] });
    expect(bill.lines).toEqual([]);
    expect(bill.totalMinor).toBe(0);
  });

  it("works out a whole-bill percentage discount as a negative line", () => {
    const sibling: DiscountRule = { id: "d1", name: "Sibling 10%", kind: "PERCENT", value: 10, feeTypeId: null };
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: new Set(["admission"]), discounts: [sibling] });
    expect(bill.discountMinor).toBe(1700000);
    expect(bill.lines.at(-1)).toEqual({ kind: "DISCOUNT", discountId: "d1", description: "Sibling 10%", amountMinor: -1700000 });
    expect(bill.totalMinor).toBe(15300000);
  });

  it("limits an item discount to that item, and discounts never compound", () => {
    const staff: DiscountRule = { id: "d2", name: "Staff child (tuition 50%)", kind: "PERCENT", value: 50, feeTypeId: "tuition" };
    const sibling: DiscountRule = { id: "d1", name: "Sibling 10%", kind: "PERCENT", value: 10, feeTypeId: null };
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: new Set(["admission"]), discounts: [sibling, staff] });
    // 50% of tuition (75,000) + 10% of the whole 170,000 bill (17,000) — not 10% of what's left.
    expect(bill.discountMinor).toBe(7500000 + 1700000);
    expect(bill.lines.filter((l) => l.kind === "DISCOUNT").map((l) => l.description)).toEqual(["Staff child (tuition 50%)", "Sibling 10%"]);
  });

  it("never lets discounts take the bill below zero", () => {
    const full: DiscountRule = { id: "d3", name: "Full scholarship", kind: "PERCENT", value: 100, feeTypeId: null };
    const fixed: DiscountRule = { id: "d4", name: "Bursary", kind: "FIXED", value: 99999999, feeTypeId: null };
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: none, discounts: [full, fixed] });
    expect(bill.totalMinor).toBe(0);
    expect(bill.discountMinor).toBe(bill.subtotalMinor);
    expect(bill.unusedDiscounts.map((d) => d.name)).toEqual(["Full scholarship"]); // Bursary sorts first and uses it all
  });

  it("caps a fixed item discount at that item's amount", () => {
    const bus: DiscountRule = { id: "d5", name: "Bus subsidy", kind: "FIXED", value: 5000000, feeTypeId: "bus" };
    const bill = computeBill({ items, signedUp: new Set(["bus"]), alreadyBilledOneOff: new Set(["admission"]), discounts: [bus] });
    expect(bill.discountMinor).toBe(3000000);
  });

  it("reports a discount for an item that isn't billed as unused", () => {
    const bus: DiscountRule = { id: "d5", name: "Bus subsidy", kind: "FIXED", value: 500000, feeTypeId: "bus" };
    const bill = computeBill({ items, signedUp: none, alreadyBilledOneOff: none, discounts: [bus] });
    expect(bill.discountMinor).toBe(0);
    expect(bill.unusedDiscounts).toEqual([{ id: "d5", name: "Bus subsidy" }]);
    expect(bill.lines.every((l) => l.kind === "FEE")).toBe(true);
  });

  it("lines always add up to the total", () => {
    const discounts: DiscountRule[] = [
      { id: "a", name: "A", kind: "PERCENT", value: 33.33, feeTypeId: null },
      { id: "b", name: "B", kind: "FIXED", value: 12345, feeTypeId: "dev" },
    ];
    const bill = computeBill({ items, signedUp: new Set(["bus"]), alreadyBilledOneOff: none, discounts });
    expect(bill.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(bill.totalMinor);
    expect(Number.isInteger(bill.totalMinor)).toBe(true);
  });
});

describe("schedule helpers", () => {
  it("compulsoryTotal ignores optional items", () => {
    expect(compulsoryTotal(items)).toBe(22000000);
  });

  it("parseScheduleCells: blank = not charged; bad amounts reported by position", () => {
    const { issues, parsed } = parseScheduleCells([
      { feeTypeId: "t", classId: "c1", amount: "150,000" },
      { feeTypeId: "t", classId: "c2", amount: "" },
      { feeTypeId: "t", classId: "c3", amount: "12.345" },
      { feeTypeId: "t", classId: "c4", amount: "100000000000" },
    ]);
    expect(parsed.map((p) => p.amountMinor)).toEqual([15000000, 0]);
    expect(issues).toEqual([
      { index: 2, code: "invalidAmount" },
      { index: 3, code: "tooLarge" },
    ]);
  });

  it("discountAppliesToTerm: whole-year assignments apply to every term of that year only", () => {
    const term = { id: "t2", academicYearId: "y1" };
    expect(discountAppliesToTerm({ termId: null, academicYearId: "y1" }, term)).toBe(true);
    expect(discountAppliesToTerm({ termId: "t2", academicYearId: "y1" }, term)).toBe(true);
    expect(discountAppliesToTerm({ termId: "t1", academicYearId: "y1" }, term)).toBe(false);
    expect(discountAppliesToTerm({ termId: null, academicYearId: "y0" }, term)).toBe(false);
  });
});
