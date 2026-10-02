import { describe, expect, it } from "vitest";
import { computeBill, toMinor } from "./fees";
import {
  checkAdjustment,
  checkPayment,
  checkReversal,
  displayStatus,
  documentNumber,
  invoiceFromBill,
  invoiceStatusFor,
  summarizeInvoices,
  toSignedMinor,
} from "./invoicing";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("invoice status", () => {
  it("follows the money", () => {
    expect(invoiceStatusFor(100000, 0)).toBe("ISSUED");
    expect(invoiceStatusFor(100000, 1)).toBe("PARTIALLY_PAID");
    expect(invoiceStatusFor(100000, 100000)).toBe("PAID");
    expect(invoiceStatusFor(0, 0)).toBe("PAID"); // fully discounted
  });

  it("shows unpaid and part-paid invoices past their due date as overdue", () => {
    const today = d("2026-10-20");
    expect(displayStatus({ status: "ISSUED", dueDate: d("2026-10-19") }, today)).toBe("OVERDUE");
    expect(displayStatus({ status: "PARTIALLY_PAID", dueDate: d("2026-10-01") }, today)).toBe("OVERDUE");
    expect(displayStatus({ status: "ISSUED", dueDate: d("2026-10-20") }, today)).toBe("ISSUED"); // due today isn't late
    expect(displayStatus({ status: "PAID", dueDate: d("2026-01-01") }, today)).toBe("PAID");
    expect(displayStatus({ status: "CANCELLED", dueDate: d("2026-01-01") }, today)).toBe("CANCELLED");
  });
});

describe("document numbers", () => {
  it("pads to five digits and keeps growing past them", () => {
    expect(documentNumber("INV", 2026, 42)).toBe("INV-2026-00042");
    expect(documentNumber("RCT", 2026, 123456)).toBe("RCT-2026-123456");
  });
});

describe("invoiceFromBill", () => {
  it("turns fee and discount lines into ordered invoice lines with the same totals", () => {
    const bill = computeBill({
      items: [
        { feeTypeId: "t", name: "Tuition", amountMinor: 15000000, isOptional: false, isOneOff: false },
        { feeTypeId: "b", name: "Bus", amountMinor: 3000000, isOptional: true, isOneOff: false },
      ],
      signedUp: new Set(["b"]),
      alreadyBilledOneOff: new Set(),
      discounts: [{ id: "d", name: "Staff child", kind: "PERCENT", value: 50, feeTypeId: "t" }],
    });
    const inv = invoiceFromBill(bill);
    expect(inv.lines.map((l) => [l.kind, l.description, l.amountMinor, l.position])).toEqual([
      ["FEE", "Tuition", 15000000, 0],
      ["FEE", "Bus", 3000000, 1],
      ["DISCOUNT", "Staff child", -7500000, 2],
    ]);
    expect(inv.totalMinor).toBe(10500000);
    expect(inv.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(inv.totalMinor);
  });
});

describe("checkPayment", () => {
  const invoice = { status: "PARTIALLY_PAID" as const, totalMinor: 10000000, paidMinor: 4000000 };
  const today = d("2026-10-10");
  it("accepts up to the balance", () => {
    expect(checkPayment({ amountMinor: 6000000, invoice, paidOn: today, today })).toBeNull();
    expect(checkPayment({ amountMinor: 1, invoice, paidOn: d("2026-09-01"), today })).toBeNull();
  });
  it("refuses overpayment, zero, fractions of a kobo, future dates", () => {
    expect(checkPayment({ amountMinor: 6000001, invoice, paidOn: today, today })).toBe("moreThanBalance");
    expect(checkPayment({ amountMinor: 0, invoice, paidOn: today, today })).toBe("notPositive");
    expect(checkPayment({ amountMinor: 1.5, invoice, paidOn: today, today })).toBe("notPositive");
    expect(checkPayment({ amountMinor: 100, invoice, paidOn: d("2026-10-11"), today })).toBe("futureDate");
  });
  it("refuses payments on cancelled or settled invoices", () => {
    expect(checkPayment({ amountMinor: 100, invoice: { ...invoice, status: "CANCELLED" }, paidOn: today, today })).toBe("invoiceCancelled");
    expect(checkPayment({ amountMinor: 100, invoice: { ...invoice, paidMinor: 10000000 }, paidOn: today, today })).toBe("invoicePaid");
  });
});

describe("checkAdjustment", () => {
  const base = { status: "PARTIALLY_PAID" as const, totalMinor: 10000000, paidMinor: 4000000 };
  it("allows extra charges and credits that keep the total at or above what's paid", () => {
    expect(checkAdjustment({ ...base, amountMinor: 500000 })).toBeNull();
    expect(checkAdjustment({ ...base, amountMinor: -6000000 })).toBeNull(); // total = paid → PAID
  });
  it("refuses zero, going below what's paid, below zero, and cancelled invoices", () => {
    expect(checkAdjustment({ ...base, amountMinor: 0 })).toBe("zero");
    expect(checkAdjustment({ ...base, amountMinor: -6000001 })).toBe("belowPaid");
    expect(checkAdjustment({ ...base, paidMinor: 0, amountMinor: -10000001 })).toBe("belowZero");
    expect(checkAdjustment({ ...base, status: "CANCELLED", amountMinor: 100 })).toBe("invoiceCancelled");
  });
});

describe("checkReversal", () => {
  it("allows reversing a payment once, never a reversal", () => {
    expect(checkReversal({ kind: "PAYMENT", reversed: false })).toBeNull();
    expect(checkReversal({ kind: "PAYMENT", reversed: true })).toBe("alreadyReversed");
    expect(checkReversal({ kind: "REVERSAL", reversed: false })).toBe("notAPayment");
  });
});

describe("toSignedMinor", () => {
  it("parses signed amounts exactly", () => {
    expect(toSignedMinor("-5,000", toMinor)).toBe(-500000);
    expect(toSignedMinor("+12.50", toMinor)).toBe(1250);
    expect(toSignedMinor("300", toMinor)).toBe(30000);
    expect(toSignedMinor("--3", toMinor)).toBeNull();
    expect(toSignedMinor("abc", toMinor)).toBeNull();
  });
});

describe("summarizeInvoices", () => {
  it("ignores cancelled invoices and works out outstanding, overdue and collection rate", () => {
    const today = d("2026-10-20");
    const s = summarizeInvoices(
      [
        { status: "PAID", totalMinor: 100, paidMinor: 100, dueDate: d("2026-10-01") },
        { status: "PARTIALLY_PAID", totalMinor: 200, paidMinor: 50, dueDate: d("2026-10-01") },
        { status: "ISSUED", totalMinor: 300, paidMinor: 0, dueDate: d("2026-11-01") },
        { status: "CANCELLED", totalMinor: 999, paidMinor: 0, dueDate: d("2026-10-01") },
      ],
      today,
    );
    expect(s).toEqual({ count: 3, billed: 600, paid: 150, outstanding: 450, overdue: 150, rate: 0.25 });
    expect(summarizeInvoices([], today).rate).toBeNull();
  });
});
