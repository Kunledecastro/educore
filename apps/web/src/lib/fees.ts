/**
 * Fee maths (Phase 3). Pure and tested — no database, no floats.
 *
 * Every amount is handled as an integer number of minor units (kobo, cents):
 * "1500.50" → 150050. Decimal strings from the database are parsed exactly,
 * never through parseFloat, so ₦0.10 + ₦0.20 is exactly ₦0.30.
 * Number.MAX_SAFE_INTEGER kobo is ~₦90 trillion, far above Decimal(12,2).
 */

/** Largest amount Decimal(12,2) can hold, in minor units. */
export const MAX_MINOR = 9_999_999_999_99;

/**
 * Parses a money amount ("1500", "1,500.5", "1500.50", a Prisma Decimal, a
 * number) into minor units. Returns null for anything that isn't a valid,
 * non-negative amount with at most 2 decimals.
 */
export function toMinor(value: string | number | { toString(): string } | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  let s = (typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : value.toString()).trim();
  s = s.replace(/,/g, "");
  if (s === "") return null;
  const m = /^(\d+)(?:\.(\d{0,2})(0*))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!.replace(/^0+(?=\d)/, "");
  const frac = (m[2] ?? "").padEnd(2, "0");
  if (whole.length > 10) return null;
  const minor = Number(whole) * 100 + Number(frac);
  return minor <= MAX_MINOR ? minor : null;
}

/** Minor units → plain decimal string for the database ("150050" → "1500.50"). */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Minor units → number of major units, for Intl formatting only. */
export function minorToNumber(minor: number): number {
  return minor / 100;
}

/** percent (e.g. 12.5) of amount, rounded half-up to the nearest minor unit. */
export function percentOf(amountMinor: number, percent: number): number {
  // percent has at most 2 decimals: work in hundredths of a percent to stay integral.
  const bp = BigInt(Math.round(percent * 100)); // 12.5% → 1250
  // BigInt: amount × basis points can pass 2^53 for very large bills.
  return Number((BigInt(amountMinor) * bp + BigInt(5000)) / BigInt(10000));
}

// ---------------------------------------------------------------------------
// Billing preview — what a student is charged for a term
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  feeTypeId: string;
  name: string;
  amountMinor: number;
  isOptional: boolean;
  isOneOff: boolean;
}

export interface DiscountRule {
  id: string;
  name: string;
  kind: "PERCENT" | "FIXED";
  /** Percent (0–100] for PERCENT; minor units for FIXED. */
  value: number;
  /** Limit to one fee item; null = the whole bill. */
  feeTypeId: string | null;
}

export type BillLine =
  | { kind: "FEE"; feeTypeId: string; description: string; amountMinor: number }
  | { kind: "DISCOUNT"; discountId: string; description: string; amountMinor: number };

export type SkipReason = "notSignedUp" | "alreadyBilled";

export interface Bill {
  lines: BillLine[];
  /** Items in the schedule this student is NOT charged, and why. */
  skipped: { feeTypeId: string; name: string; reason: SkipReason }[];
  /** Discounts assigned but worth nothing here (e.g. limited to an item not billed). */
  unusedDiscounts: { id: string; name: string }[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
}

/**
 * The bill for one student and term:
 *  - compulsory items always; optional items only if signed up;
 *    one-off items only if never billed to this student before;
 *  - each discount is worked out on its base (the whole bill, or its one item)
 *    independently — discounts never compound — and a discount can't exceed
 *    what's left of its base, so the total never goes below zero.
 * Discount lines carry NEGATIVE amounts.
 */
export function computeBill(input: {
  items: ScheduleItem[];
  signedUp: ReadonlySet<string>;
  alreadyBilledOneOff: ReadonlySet<string>;
  discounts: DiscountRule[];
}): Bill {
  const lines: BillLine[] = [];
  const skipped: Bill["skipped"] = [];
  const charged = new Map<string, number>();

  for (const item of input.items) {
    if (item.amountMinor <= 0) continue;
    if (item.isOptional && !input.signedUp.has(item.feeTypeId)) {
      skipped.push({ feeTypeId: item.feeTypeId, name: item.name, reason: "notSignedUp" });
      continue;
    }
    if (item.isOneOff && input.alreadyBilledOneOff.has(item.feeTypeId)) {
      skipped.push({ feeTypeId: item.feeTypeId, name: item.name, reason: "alreadyBilled" });
      continue;
    }
    lines.push({ kind: "FEE", feeTypeId: item.feeTypeId, description: item.name, amountMinor: item.amountMinor });
    charged.set(item.feeTypeId, (charged.get(item.feeTypeId) ?? 0) + item.amountMinor);
  }

  const subtotalMinor = [...charged.values()].reduce((a, b) => a + b, 0);
  // What's still discountable, per item and overall.
  const leftOnItem = new Map(charged);
  let leftOverall = subtotalMinor;
  const unusedDiscounts: Bill["unusedDiscounts"] = [];
  let discountMinor = 0;

  // Item-limited discounts first (they're the narrower promise), then whole-bill ones; stable by name.
  const ordered = [...input.discounts].sort(
    (a, b) => Number(a.feeTypeId === null) - Number(b.feeTypeId === null) || a.name.localeCompare(b.name),
  );
  for (const d of ordered) {
    const base = d.feeTypeId === null ? subtotalMinor : charged.get(d.feeTypeId) ?? 0;
    const room = d.feeTypeId === null ? leftOverall : Math.min(leftOnItem.get(d.feeTypeId) ?? 0, leftOverall);
    const wanted = d.kind === "PERCENT" ? percentOf(base, d.value) : d.value;
    const amount = Math.max(0, Math.min(wanted, room));
    if (amount === 0) {
      unusedDiscounts.push({ id: d.id, name: d.name });
      continue;
    }
    leftOverall -= amount;
    if (d.feeTypeId !== null) leftOnItem.set(d.feeTypeId, (leftOnItem.get(d.feeTypeId) ?? 0) - amount);
    discountMinor += amount;
    lines.push({ kind: "DISCOUNT", discountId: d.id, description: d.name, amountMinor: -amount });
  }

  return { lines, skipped, unusedDiscounts, subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

/** Sum of a class's compulsory items for a term — the "headline" fee per class. */
export function compulsoryTotal(items: Pick<ScheduleItem, "amountMinor" | "isOptional">[]): number {
  return items.filter((i) => !i.isOptional).reduce((a, i) => a + i.amountMinor, 0);
}

export interface ScheduleCell {
  feeTypeId: string;
  classId: string;
  /** Raw text as typed; "" means "not charged". */
  amount: string;
}

export type ScheduleIssue = { index: number; code: "invalidAmount" | "tooLarge" };

/** Validates typed schedule amounts; returns parsed cells (minor units, 0 = not charged). */
export function parseScheduleCells(cells: ScheduleCell[]): { issues: ScheduleIssue[]; parsed: (ScheduleCell & { amountMinor: number })[] } {
  const issues: ScheduleIssue[] = [];
  const parsed: (ScheduleCell & { amountMinor: number })[] = [];
  cells.forEach((cell, index) => {
    const raw = cell.amount.trim();
    if (raw === "") {
      parsed.push({ ...cell, amountMinor: 0 });
      return;
    }
    const minor = toMinor(raw);
    if (minor === null) {
      const digits = raw.replace(/,/g, "").split(".")[0] ?? "";
      issues.push({ index, code: /^\d{11,}$/.test(digits) ? "tooLarge" : "invalidAmount" });
      return;
    }
    parsed.push({ ...cell, amountMinor: minor });
  });
  return { issues, parsed };
}

/** Is this discount's assignment in force for the term? (termId null = whole year) */
export function discountAppliesToTerm(assignment: { termId: string | null; academicYearId: string }, term: { id: string; academicYearId: string }) {
  return assignment.academicYearId === term.academicYearId && (assignment.termId === null || assignment.termId === term.id);
}
