import "server-only";
import type { Prisma, TenantScopedClient } from "@educore/db";

export interface LessonView {
  id: string;
  dayOfWeek: number;
  period: number;
  subject: string;
  teacher: string;
  section: string;
  sectionId: string;
  room: string | null;
}

export interface PeriodView {
  number: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export function loadPeriods(db: TenantScopedClient): Promise<PeriodView[]> {
  return db.timetablePeriod.findMany({
    orderBy: { number: "asc" },
    select: { number: true, label: true, startTime: true, endTime: true, isBreak: true },
  });
}

/** Lessons matching `where` (tenant-scoped), shaped for the grid. */
export async function loadLessons(db: TenantScopedClient, where: Prisma.TimetableEntryWhereInput): Promise<LessonView[]> {
  const rows = await db.timetableEntry.findMany({
    where,
    select: {
      id: true,
      dayOfWeek: true,
      period: true,
      room: true,
      sectionId: true,
      subject: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    dayOfWeek: r.dayOfWeek,
    period: r.period,
    subject: r.subject.name,
    teacher: r.teacher.user.name,
    section: `${r.section.class.name} ${r.section.name}`,
    sectionId: r.sectionId,
    room: r.room,
  }));
}

/** Short weekday names in the school's locale, Monday=1 … Friday=5. */
export function dayNames(locale: string, style: "short" | "long" = "short"): Record<number, string> {
  const f = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" });
  // 2024-01-01 was a Monday.
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 0].map((d, i) => [d, f.format(new Date(Date.UTC(2024, 0, 1 + i)))]));
}
