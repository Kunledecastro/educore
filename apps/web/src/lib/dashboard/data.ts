import "server-only";
import type { Prisma, TenantScopedClient } from "@educore/db";
import { loadClassResults } from "../class-results";
import { toMinor } from "../fees";

/**
 * What each dashboard shows (Phase 9.1). Every query runs on the school's
 * tenant-scoped client, so it can only ever see this school's rows; parents
 * and teachers are narrowed further to their own children and classes.
 */

type Db = TenantScopedClient;
const m = (v: Prisma.Decimal | null | undefined) => (v ? (toMinor(v) ?? 0) : 0);
const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/** Monday of the week a UTC date falls in. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  return x;
}

/** Share of marks that were present or late, per week, for the last `weeks` weeks of school. */
export function weeklyRates(rows: readonly { date: Date; status: string; count: number }[]): { week: string; rate: number }[] {
  const byWeek = new Map<string, { here: number; all: number }>();
  for (const r of rows) {
    const k = weekStart(r.date).toISOString().slice(0, 10);
    const w = byWeek.get(k) ?? { here: 0, all: 0 };
    w.all += r.count;
    if (r.status === "PRESENT" || r.status === "LATE") w.here += r.count;
    byWeek.set(k, w);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, w]) => w.all > 0)
    .map(([week, w]) => ({ week, rate: Math.round((w.here / w.all) * 1000) / 10 }));
}

export async function attendanceTrend(db: Db, today: Date, opts: { from?: Date; weeks?: number; sectionIds?: string[]; studentIds?: string[] } = {}) {
  const weeks = opts.weeks ?? 6;
  const earliest = weekStart(new Date(today.getTime() - (weeks - 1) * 7 * 86_400_000));
  const from = opts.from && opts.from > earliest ? opts.from : earliest;
  const rows = await db.attendance.groupBy({
    by: ["date", "status"],
    where: { date: { gte: from, lte: today }, academicYear: { isActive: true }, ...(opts.sectionIds ? { sectionId: { in: opts.sectionIds } } : {}), ...(opts.studentIds ? { studentId: { in: opts.studentIds } } : {}) },
    _count: { _all: true },
  });
  return weeklyRates(rows.map((r) => ({ date: r.date, status: r.status, count: r._count._all })));
}

export async function attendanceToday(db: Db, today: Date) {
  const [pupils, here, marked] = await Promise.all([
    db.student.count({ where: { status: "ACTIVE", academicYear: { isActive: true } } }),
    db.attendance.count({ where: { date: today, status: { in: ["PRESENT", "LATE"] } } }),
    db.attendance.count({ where: { date: today } }),
  ]);
  return { pupils, here, absent: Math.max(0, marked - here), marked };
}

/** Sections (with pupils) whose register isn't complete today, with their form teacher and any reminder sent. */
export async function registersNotTaken(db: Db, today: Date, sectionIds: string[] | "all" = "all") {
  if (sectionIds !== "all" && sectionIds.length === 0) return { total: 0, missing: [] as { sectionId: string; name: string; formTeacher: string | null; pupils: number; reminded: boolean }[] };
  const sections = await db.section.findMany({
    where: { class: { academicYear: { isActive: true } }, ...(sectionIds === "all" ? {} : { id: { in: sectionIds } }) },
    select: {
      id: true,
      name: true,
      class: { select: { name: true, order: true } },
      formTeacher: { select: { user: { select: { name: true, email: true } } } },
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });
  const withPupils = sections.filter((s) => s._count.students > 0);
  if (withPupils.length === 0) return { total: 0, missing: [] };
  const [marked, reminders] = await Promise.all([
    db.attendance.groupBy({ by: ["sectionId"], where: { date: today, sectionId: { in: withPupils.map((s) => s.id) }, student: { status: "ACTIVE" } }, _count: { _all: true } }),
    db.registerReminder.findMany({ where: { date: today, sectionId: { in: withPupils.map((s) => s.id) } }, select: { sectionId: true } }),
  ]);
  const done = new Map(marked.map((x) => [x.sectionId, x._count._all]));
  const reminded = new Set(reminders.map((r) => r.sectionId));
  const missing = withPupils
    .filter((s) => (done.get(s.id) ?? 0) < s._count.students)
    .sort((a, b) => a.class.order - b.class.order || a.class.name.localeCompare(b.class.name) || a.name.localeCompare(b.name))
    .map((s) => ({ sectionId: s.id, name: `${s.class.name} ${s.name}`, formTeacher: s.formTeacher?.user.name ?? s.formTeacher?.user.email ?? null, pupils: s._count.students, reminded: reminded.has(s.id) }));
  return { total: withPupils.length, missing };
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** Billed and paid per class this term (cancelled invoices left out). */
export async function feesByClass(db: Db, termId: string) {
  const invoices = await db.invoice.findMany({
    where: { termId, status: { not: "CANCELLED" } },
    select: { totalDue: true, amountPaid: true, student: { select: { class: { select: { id: true, name: true, order: true } } } } },
  });
  const by = new Map<string, { key: string; name: string; order: number; billed: number; paid: number }>();
  for (const inv of invoices) {
    const c = inv.student.class;
    const key = c?.id ?? "none";
    const row = by.get(key) ?? { key, name: c?.name ?? "—", order: c?.order ?? 9999, billed: 0, paid: 0 };
    row.billed += m(inv.totalDue);
    row.paid += m(inv.amountPaid);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Families owing the most, and how many owe past the due date. */
export async function debtors(db: Db, today: Date, take = 5) {
  const open = await db.invoice.findMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
    select: { totalDue: true, amountPaid: true, dueDate: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } } } } },
    take: 5000,
  });
  const by = new Map<string, { studentId: string; name: string; admissionNo: string; className: string | null; owed: number; overdue: boolean }>();
  for (const inv of open) {
    const owed = m(inv.totalDue) - m(inv.amountPaid);
    if (owed <= 0) continue;
    const s = inv.student;
    const row = by.get(s.id) ?? { studentId: s.id, name: fullName(s), admissionNo: s.admissionNo, className: s.class?.name ?? null, owed: 0, overdue: false };
    row.owed += owed;
    row.overdue ||= inv.dueDate < today;
    by.set(s.id, row);
  }
  const rows = [...by.values()].sort((a, b) => b.owed - a.owed);
  return { top: rows.slice(0, take), overdueFamilies: rows.filter((r) => r.overdue).length };
}

export async function latestPayments(db: Db, take = 5) {
  const rows = await db.payment.findMany({
    where: { kind: "PAYMENT", reversedBy: null },
    orderBy: { paidAt: "desc" },
    take,
    select: { id: true, amount: true, method: true, paidAt: true, receiptNo: true, student: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((p) => ({ id: p.id, pupil: fullName(p.student), amountMinor: m(p.amount), method: p.method, paidAt: p.paidAt, receiptNo: p.receiptNo }));
}

export async function collectedSince(db: Db, since: Date) {
  const agg = await db.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: since } } });
  return m(agg._sum.amount);
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

/** A teacher's lessons today in time order, each with whether that class's register is taken. */
export async function teacherToday(db: Db, teacherId: string, today: Date) {
  const lessons = await db.timetableEntry.findMany({
    where: { teacherId, dayOfWeek: today.getUTCDay(), academicYear: { isActive: true } },
    orderBy: [{ startTime: "asc" }, { period: "asc" }],
    select: { id: true, startTime: true, endTime: true, room: true, sectionId: true, subjectId: true, section: { select: { name: true, class: { select: { name: true } } } }, subject: { select: { name: true } } },
  });
  const sectionIds = [...new Set(lessons.map((l) => l.sectionId))];
  const marked = sectionIds.length ? await db.attendance.groupBy({ by: ["sectionId"], where: { date: today, sectionId: { in: sectionIds } }, _count: { _all: true } }) : [];
  const taken = new Set(marked.filter((x) => x._count._all > 0).map((x) => x.sectionId));
  return lessons.map((l) => ({ id: l.id, time: `${l.startTime}–${l.endTime}`, className: `${l.section.class.name} ${l.section.name}`, subject: l.subject.name, room: l.room, sectionId: l.sectionId, subjectId: l.subjectId, registerTaken: taken.has(l.sectionId) }));
}

/** Reminders the office sent this teacher today about their form classes' registers. */
export async function remindersFor(db: Db, formSectionIds: string[], today: Date) {
  if (!formSectionIds.length) return [];
  const rows = await db.registerReminder.findMany({ where: { date: today, sectionId: { in: formSectionIds } }, select: { sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } } });
  return rows.map((r) => ({ sectionId: r.sectionId, name: `${r.section.class.name} ${r.section.name}` }));
}

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

/** A parent's own children only: class, form teacher, attendance this term and money owed. */
export async function parentChildren(db: Db, userId: string, term: { startDate: Date } | null, today: Date) {
  const guardian = await db.guardian.findUnique({
    where: { userId },
    select: {
      students: {
        select: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              status: true,
              classId: true,
              academicYearId: true,
              class: { select: { name: true } },
              section: { select: { name: true, formTeacher: { select: { user: { select: { name: true } } } } } },
            },
          },
        },
      },
    },
  });
  const kids = (guardian?.students ?? []).map((g) => g.student).filter((s) => s.status === "ACTIVE");
  if (kids.length === 0) return [];
  const ids = kids.map((k) => k.id);
  const [att, open] = await Promise.all([
    db.attendance.groupBy({ by: ["studentId", "status"], where: { studentId: { in: ids }, academicYear: { isActive: true }, ...(term ? { date: { gte: term.startDate, lte: today } } : {}) }, _count: { _all: true } }),
    db.invoice.findMany({ where: { studentId: { in: ids }, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { id: true, studentId: true, totalDue: true, amountPaid: true, dueDate: true }, orderBy: { dueDate: "asc" } }),
  ]);
  return kids.map((k) => {
    const mine = att.filter((a) => a.studentId === k.id);
    const all = mine.reduce((n, a) => n + a._count._all, 0);
    const here = mine.filter((a) => a.status === "PRESENT" || a.status === "LATE").reduce((n, a) => n + a._count._all, 0);
    const absent = mine.filter((a) => a.status === "ABSENT").reduce((n, a) => n + a._count._all, 0);
    const bills = open.filter((i) => i.studentId === k.id).map((i) => ({ id: i.id, owed: m(i.totalDue) - m(i.amountPaid), dueDate: i.dueDate })).filter((i) => i.owed > 0);
    return {
      id: k.id,
      name: fullName(k),
      firstName: k.firstName,
      classId: k.classId,
      academicYearId: k.academicYearId,
      className: [k.class?.name, k.section?.name].filter(Boolean).join(" ") || null,
      formTeacher: k.section?.formTeacher?.user.name ?? null,
      attendanceRate: all ? Math.round((here / all) * 100) : null,
      absences: absent,
      owedMinor: bills.reduce((n, b) => n + b.owed, 0),
      nextDue: bills[0]?.dueDate ?? null,
      payInvoiceId: bills[0]?.id ?? null,
    };
  });
}

/** A family's view of results: the most recent PUBLISHED term for the child's class, with the child's average. */
export async function latestPublishedResult(db: Db, child: { id: string; classId: string | null; academicYearId: string | null }) {
  if (!child.classId || !child.academicYearId) return null;
  const terms = await db.term.findMany({ where: { academicYearId: child.academicYearId }, orderBy: { order: "desc" }, select: { id: true, name: true } });
  const pubs = await db.resultPublication.findMany({ where: { classId: child.classId, termId: { in: terms.map((t) => t.id) } }, select: { termId: true } });
  const published = new Set(pubs.map((p) => p.termId));
  const term = terms.find((t) => published.has(t.id));
  if (!term) return null;
  const results = await loadClassResults(db, child.classId, term.id, child.id);
  const me = results.students.find((s) => s.id === child.id);
  if (!me || me.average === null) return null;
  return { termName: term.name, average: me.average, position: me.position, positionOutOf: me.positionOutOf };
}
