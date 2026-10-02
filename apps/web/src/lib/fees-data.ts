import "server-only";
import type { TenantScopedClient } from "@educore/db";
import { computeBill, discountAppliesToTerm, toMinor, type Bill, type DiscountRule, type ScheduleItem } from "./fees";
import { todayInTimeZone } from "./format";
import { resolveCurrentTerm } from "./terms";

/**
 * Fee setup reads (milestone 3.0). Tenant-scoped client only; every query
 * is also limited by RLS.
 */

export interface TermOption {
  id: string;
  name: string;
  academicYearId: string;
  yearName: string;
  isCurrent: boolean;
}

/**
 * Terms a fee screen can pick from: the active year's terms plus the next
 * year's (schools set next year's fees before it starts). Selected = the
 * `?term=` one if valid, else the current term, else the first.
 */
export async function feeTerms(db: TenantScopedClient, timezone: string, requested?: string) {
  const years = await db.academicYear.findMany({
    orderBy: { startDate: "asc" },
    include: { terms: { orderBy: { order: "asc" } } },
  });
  const active = years.find((y) => y.isActive);
  const relevant = active ? years.filter((y) => y.startDate >= active.startDate).slice(0, 2) : years.slice(-1);
  const terms: TermOption[] = relevant.flatMap((y) =>
    y.terms.map((t) => ({ id: t.id, name: relevant.length > 1 ? `${t.name} · ${y.name}` : t.name, academicYearId: y.id, yearName: y.name, isCurrent: t.isCurrent })),
  );
  const current = active ? resolveCurrentTerm(active.terms, todayInTimeZone(timezone)) : null;
  const selected = terms.find((t) => t.id === requested) ?? terms.find((t) => t.id === current?.id) ?? terms[0] ?? null;
  return { terms, selected, hasYear: years.length > 0 };
}

export interface ScheduleView {
  items: { id: string; name: string; isOptional: boolean; isOneOff: boolean; isActive: boolean }[];
  classes: { id: string; name: string; students: number }[];
  /** "feeTypeId:classId" → amount as a plain decimal string */
  amounts: Record<string, string>;
}

export async function loadSchedule(db: TenantScopedClient, term: { id: string; academicYearId: string }): Promise<ScheduleView> {
  const [items, classes, rows] = await Promise.all([
    db.feeType.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true, isOptional: true, isOneOff: true, isActive: true } }),
    db.classGrade.findMany({
      where: { academicYearId: term.academicYearId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, _count: { select: { students: { where: { status: "ACTIVE" } } } } },
    }),
    db.feeStructure.findMany({ where: { termId: term.id }, select: { feeTypeId: true, classId: true, amount: true } }),
  ]);
  const amounts: Record<string, string> = {};
  for (const r of rows) if (r.classId) amounts[`${r.feeTypeId}:${r.classId}`] = r.amount.toString();
  const used = new Set(rows.map((r) => r.feeTypeId));
  return {
    // Inactive items stay visible only while they still have amounts this term.
    items: items.filter((i) => i.isActive || used.has(i.id)),
    classes: classes.map((c) => ({ id: c.id, name: c.name, students: c._count.students })),
    amounts,
  };
}

export function toDiscountRule(d: { id: string; name: string; kind: "PERCENT" | "FIXED"; value: { toString(): string }; feeTypeId: string | null }): DiscountRule {
  const minor = toMinor(d.value) ?? 0;
  return { id: d.id, name: d.name, kind: d.kind, value: d.kind === "PERCENT" ? minor / 100 : minor, feeTypeId: d.feeTypeId };
}

/**
 * What a student would be billed for a term, from the schedule of their
 * class, their optional sign-ups, one-off items already invoiced to them,
 * and their discounts in force that term. Null if the student isn't found
 * or isn't in a class of that term's year.
 */
export async function billFor(
  db: TenantScopedClient,
  studentId: string,
  term: { id: string; academicYearId: string },
): Promise<(Bill & { classId: string }) | null> {
  const student = await db.student.findFirst({ where: { id: studentId }, select: { id: true, classId: true, class: { select: { academicYearId: true } } } });
  if (!student?.classId || student.class?.academicYearId !== term.academicYearId) return null;

  const [schedule, signups, billedLines, assigned] = await Promise.all([
    db.feeStructure.findMany({
      where: { termId: term.id, classId: student.classId, feeType: { isActive: true } },
      select: { amount: true, feeType: { select: { id: true, name: true, isOptional: true, isOneOff: true, order: true } } },
    }),
    db.feeSignup.findMany({ where: { termId: term.id, studentId }, select: { feeTypeId: true } }),
    db.invoiceLine.findMany({
      where: { invoice: { studentId, status: { not: "CANCELLED" } }, feeStructure: { feeType: { isOneOff: true } } },
      select: { feeStructure: { select: { feeTypeId: true } } },
    }),
    db.studentDiscount.findMany({
      where: { studentId, academicYearId: term.academicYearId, discount: { isActive: true } },
      select: { termId: true, academicYearId: true, discount: { select: { id: true, name: true, kind: true, value: true, feeTypeId: true } } },
    }),
  ]);

  const items: ScheduleItem[] = schedule
    .sort((a, b) => a.feeType.order - b.feeType.order || a.feeType.name.localeCompare(b.feeType.name))
    .map((s) => ({
      feeTypeId: s.feeType.id,
      name: s.feeType.name,
      amountMinor: toMinor(s.amount) ?? 0,
      isOptional: s.feeType.isOptional,
      isOneOff: s.feeType.isOneOff,
    }));
  // The same discount assigned for the term AND the year still applies once.
  const discounts = new Map<string, DiscountRule>();
  for (const a of assigned) if (discountAppliesToTerm(a, term)) discounts.set(a.discount.id, toDiscountRule(a.discount));

  const bill = computeBill({
    items,
    signedUp: new Set(signups.map((s) => s.feeTypeId)),
    alreadyBilledOneOff: new Set(billedLines.flatMap((l) => (l.feeStructure ? [l.feeStructure.feeTypeId] : []))),
    discounts: [...discounts.values()],
  });
  return { ...bill, classId: student.classId };
}
