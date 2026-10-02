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
 * What students would be billed for a term, from the schedule of their
 * class, their optional sign-ups, one-off items already invoiced to them,
 * and their discounts in force that term. Students not in a class of that
 * term's year are left out. Bulk: a fixed number of queries for any number
 * of students — used by the bill preview, the billing preview and the
 * background billing run alike, so all three always agree.
 */
export async function billsFor(
  db: TenantScopedClient,
  term: { id: string; academicYearId: string },
  studentIds: string[],
): Promise<Map<string, Bill & { classId: string }>> {
  const out = new Map<string, Bill & { classId: string }>();
  if (studentIds.length === 0) return out;
  const students = await db.student.findMany({
    where: { id: { in: studentIds }, class: { academicYearId: term.academicYearId } },
    select: { id: true, classId: true },
  });
  const classIds = [...new Set(students.flatMap((s) => (s.classId ? [s.classId] : [])))];
  const ids = students.map((s) => s.id);

  const [schedule, signups, billedLines, assigned] = await Promise.all([
    db.feeStructure.findMany({
      where: { termId: term.id, classId: { in: classIds }, feeType: { isActive: true } },
      select: { classId: true, amount: true, feeType: { select: { id: true, name: true, isOptional: true, isOneOff: true, order: true } } },
    }),
    db.feeSignup.findMany({ where: { termId: term.id, studentId: { in: ids } }, select: { studentId: true, feeTypeId: true } }),
    db.invoiceLine.findMany({
      where: { kind: "FEE", invoice: { studentId: { in: ids }, status: { not: "CANCELLED" } }, feeType: { isOneOff: true } },
      select: { feeTypeId: true, invoice: { select: { studentId: true } } },
    }),
    db.studentDiscount.findMany({
      where: { studentId: { in: ids }, academicYearId: term.academicYearId, discount: { isActive: true } },
      select: { studentId: true, termId: true, academicYearId: true, discount: { select: { id: true, name: true, kind: true, value: true, feeTypeId: true } } },
    }),
  ]);

  const itemsByClass = new Map<string, ScheduleItem[]>();
  for (const s of [...schedule].sort((a, b) => a.feeType.order - b.feeType.order || a.feeType.name.localeCompare(b.feeType.name))) {
    const list = itemsByClass.get(s.classId!) ?? [];
    list.push({ feeTypeId: s.feeType.id, name: s.feeType.name, amountMinor: toMinor(s.amount) ?? 0, isOptional: s.feeType.isOptional, isOneOff: s.feeType.isOneOff });
    itemsByClass.set(s.classId!, list);
  }
  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const signupsBy = group(signups, (r) => r.studentId);
  const billedBy = group(billedLines, (r) => r.invoice.studentId);
  const discountsBy = group(assigned, (r) => r.studentId);

  for (const st of students) {
    if (!st.classId) continue;
    // The same discount assigned for the term AND the year still applies once.
    const discounts = new Map<string, DiscountRule>();
    for (const a of discountsBy.get(st.id) ?? []) if (discountAppliesToTerm(a, term)) discounts.set(a.discount.id, toDiscountRule(a.discount));
    const bill = computeBill({
      items: itemsByClass.get(st.classId) ?? [],
      signedUp: new Set((signupsBy.get(st.id) ?? []).map((s) => s.feeTypeId)),
      alreadyBilledOneOff: new Set((billedBy.get(st.id) ?? []).flatMap((l) => (l.feeTypeId ? [l.feeTypeId] : []))),
      discounts: [...discounts.values()],
    });
    out.set(st.id, { ...bill, classId: st.classId });
  }
  return out;
}

/** One student's bill for a term (see billsFor). Null if they aren't in a class of that year. */
export async function billFor(
  db: TenantScopedClient,
  studentId: string,
  term: { id: string; academicYearId: string },
): Promise<(Bill & { classId: string }) | null> {
  return (await billsFor(db, term, [studentId])).get(studentId) ?? null;
}
