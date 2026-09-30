/**
 * Term rules (Phase 2, decision 1: terms set per school, default three).
 * Pure and unit-tested. Dates are date-only values stored at UTC midnight
 * (same convention as academic years).
 */

export interface TermInput {
  id?: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface YearRange {
  startDate: Date;
  endDate: Date;
}

export const DEFAULT_TERM_NAMES = ["First term", "Second term", "Third term"] as const;

export type TermIssue =
  | { code: "endBeforeStart" }
  | { code: "outsideYear" }
  | { code: "overlaps"; otherName: string }
  | { code: "tooMany" };

export const MAX_TERMS_PER_YEAR = 12;

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Checks one term against its academic year and the year's other terms.
 * Terms may touch (one ends the day before the next starts) but not overlap;
 * holidays between terms are fine.
 */
export function validateTerm(term: TermInput, year: YearRange, others: readonly TermInput[]): TermIssue[] {
  const issues: TermIssue[] = [];
  const start = day(term.startDate);
  const end = day(term.endDate);
  if (end <= start) issues.push({ code: "endBeforeStart" });
  if (start < day(year.startDate) || end > day(year.endDate)) issues.push({ code: "outsideYear" });
  const siblings = others.filter((o) => !term.id || o.id !== term.id);
  if (!term.id && siblings.length >= MAX_TERMS_PER_YEAR) issues.push({ code: "tooMany" });
  for (const o of siblings) {
    if (start <= day(o.endDate) && day(o.startDate) <= end) {
      issues.push({ code: "overlaps", otherName: o.name });
      break;
    }
  }
  return issues;
}

/**
 * Suggested dates for `count` terms: the year split into equal parts, each
 * ending the day before the next begins. The admin then adjusts them to the
 * real calendar — this just saves typing.
 */
export function suggestTerms(year: YearRange, names: readonly string[] = DEFAULT_TERM_NAMES): TermInput[] {
  const start = day(year.startDate);
  const end = day(year.endDate);
  const DAY = 86_400_000;
  const totalDays = Math.round((end - start) / DAY) + 1;
  const n = names.length;
  return names.map((name, i) => {
    const from = start + Math.floor((totalDays * i) / n) * DAY;
    const to = i === n - 1 ? end : start + (Math.floor((totalDays * (i + 1)) / n) - 1) * DAY;
    return { name, startDate: new Date(from), endDate: new Date(to) };
  });
}

/**
 * The term screens should default to: the one the school marked current;
 * otherwise the term containing `today`; otherwise the latest term that has
 * started; otherwise the first. Null only when the year has no terms.
 */
export function resolveCurrentTerm<T extends TermInput & { isCurrent?: boolean }>(terms: readonly T[], today: Date): T | null {
  if (terms.length === 0) return null;
  const marked = terms.find((t) => t.isCurrent);
  if (marked) return marked;
  const d = day(today);
  const sorted = [...terms].sort((a, b) => day(a.startDate) - day(b.startDate));
  return (
    sorted.find((t) => day(t.startDate) <= d && d <= day(t.endDate)) ??
    [...sorted].reverse().find((t) => day(t.startDate) <= d) ??
    sorted[0]!
  );
}
