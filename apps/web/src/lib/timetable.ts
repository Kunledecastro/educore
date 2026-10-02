/**
 * Timetable rules (Phase 2, milestone 2.4). Pure and tested.
 *
 * A school has one bell schedule: numbered periods with start/end times,
 * some of them breaks. Each section's week is a grid of school days ×
 * teaching periods; a lesson is subject + teacher (+ optional room).
 * ASSUMPTION: school days are Monday–Friday (same as attendance).
 */

export const SCHOOL_DAYS = [1, 2, 3, 4, 5] as const; // Mon..Fri (0 = Sunday)
export type SchoolDay = (typeof SCHOOL_DAYS)[number];

export interface PeriodInput {
  number: number;
  label: string;
  startTime: string; // "08:00"
  endTime: string;
  isBreak: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const isTime = (s: string) => TIME.test(s);

export type PeriodIssue =
  | { code: "empty" }
  | { code: "badTime"; index: number }
  | { code: "endBeforeStart"; index: number }
  | { code: "overlaps"; index: number }
  | { code: "blankLabel"; index: number }
  | { code: "noTeaching" };

/**
 * A usable bell schedule: at least one teaching period, valid HH:MM times,
 * each ending after it starts, no two periods overlapping in time.
 * Periods are numbered by their order in time.
 */
export function validatePeriods(periods: readonly PeriodInput[]): PeriodIssue[] {
  if (periods.length === 0) return [{ code: "empty" }];
  const issues: PeriodIssue[] = [];
  periods.forEach((p, index) => {
    if (!p.label.trim()) issues.push({ code: "blankLabel", index });
    if (!isTime(p.startTime) || !isTime(p.endTime)) issues.push({ code: "badTime", index });
    else if (toMinutes(p.endTime) <= toMinutes(p.startTime)) issues.push({ code: "endBeforeStart", index });
  });
  if (issues.length) return issues;
  const sorted = periods.map((p, index) => ({ ...p, index })).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i]!.startTime) < toMinutes(sorted[i - 1]!.endTime)) issues.push({ code: "overlaps", index: sorted[i]!.index });
  }
  if (!periods.some((p) => !p.isBreak)) issues.push({ code: "noTeaching" });
  return issues;
}

/** Sort by start time and number 1…n — the stored `number` always follows the clock. */
export function numberPeriods<T extends PeriodInput>(periods: readonly T[]): T[] {
  return [...periods].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)).map((p, i) => ({ ...p, number: i + 1 }));
}

export interface LessonRef {
  id?: string;
  sectionId: string;
  teacherId: string;
  room: string | null;
  dayOfWeek: number;
  period: number;
}

export type Clash =
  | { kind: "section"; with: LessonRef }
  | { kind: "teacher"; with: LessonRef }
  | { kind: "room"; with: LessonRef };

/** Room names compare case- and space-insensitively ("Lab 1" = "lab  1"). */
export const roomKey = (room: string | null | undefined) => (room ? room.trim().replace(/\s+/g, " ").toLowerCase() : "");

/**
 * What a lesson would clash with in the same day + period: the section
 * already has a lesson, the teacher is teaching elsewhere, or the room is
 * in use. `existing` = the year's lessons; the lesson being replaced (same
 * id) is ignored.
 */
export function findClashes(candidate: LessonRef, existing: readonly LessonRef[]): Clash[] {
  const clashes: Clash[] = [];
  for (const e of existing) {
    if (candidate.id && e.id === candidate.id) continue;
    if (e.dayOfWeek !== candidate.dayOfWeek || e.period !== candidate.period) continue;
    if (e.sectionId === candidate.sectionId) clashes.push({ kind: "section", with: e });
    else if (e.teacherId === candidate.teacherId) clashes.push({ kind: "teacher", with: e });
    else if (roomKey(candidate.room) && roomKey(e.room) === roomKey(candidate.room)) clashes.push({ kind: "room", with: e });
  }
  return clashes;
}

/** Lessons keyed by "day:period" for drawing a grid. */
export function gridOf<T extends { dayOfWeek: number; period: number }>(lessons: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lessons) {
    const key = `${l.dayOfWeek}:${l.period}`;
    m.set(key, [...(m.get(key) ?? []), l]);
  }
  return m;
}

/** Today's lessons in time order, for dashboards ("Today's classes"). */
export function lessonsOn<T extends { dayOfWeek: number; period: number }>(lessons: readonly T[], dayOfWeek: number): T[] {
  return lessons.filter((l) => l.dayOfWeek === dayOfWeek).sort((a, b) => a.period - b.period);
}

/** A sensible starting bell schedule (8:00–14:00, 8 periods, short break and lunch) to adjust. */
export const DEFAULT_PERIODS: readonly Omit<PeriodInput, "number">[] = [
  { label: "1", startTime: "08:00", endTime: "08:40", isBreak: false },
  { label: "2", startTime: "08:40", endTime: "09:20", isBreak: false },
  { label: "3", startTime: "09:20", endTime: "10:00", isBreak: false },
  { label: "Break", startTime: "10:00", endTime: "10:20", isBreak: true },
  { label: "4", startTime: "10:20", endTime: "11:00", isBreak: false },
  { label: "5", startTime: "11:00", endTime: "11:40", isBreak: false },
  { label: "6", startTime: "11:40", endTime: "12:20", isBreak: false },
  { label: "Lunch", startTime: "12:20", endTime: "13:00", isBreak: true },
  { label: "7", startTime: "13:00", endTime: "13:40", isBreak: false },
  { label: "8", startTime: "13:40", endTime: "14:20", isBreak: false },
];
