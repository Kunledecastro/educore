import * as React from "react";
import { cn } from "@educore/ui/utils";
import { SCHOOL_DAYS } from "@/lib/timetable";
import type { LessonView, PeriodView } from "@/lib/timetable-data";

/**
 * Weekly timetable grid: periods down the side (breaks as full-width rows),
 * school days across. Read-only; `renderCell` lets the editor add buttons.
 * Scrolls sideways on phones with the period column pinned; prints cleanly.
 */
export function TimetableGrid({
  periods,
  lessons,
  days,
  caption,
  show,
  today,
  breakLabel,
  renderCell,
}: {
  periods: PeriodView[];
  lessons: LessonView[];
  days: Record<number, string>;
  caption: string;
  /** What the second line of a lesson shows. */
  show: "teacher" | "section";
  /** Highlight this weekday's column. */
  today?: number;
  breakLabel: string;
  renderCell?: (day: number, period: PeriodView, lesson: LessonView | null) => React.ReactNode;
}) {
  const byKey = new Map(lessons.map((l) => [`${l.dayOfWeek}:${l.period}`, l]));
  return (
    <div className="overflow-x-auto rounded-lg border print:overflow-visible print:border-0">
      <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-muted/50">
            <th scope="col" className="sticky left-0 z-10 w-24 bg-muted/50 px-2 py-2 text-left font-medium">
              <span className="sr-only">{breakLabel}</span>
            </th>
            {SCHOOL_DAYS.map((d) => (
              <th key={d} scope="col" className={cn("px-2 py-2 text-left font-medium", today === d && "bg-primary/10")}>
                {days[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) =>
            p.isBreak ? (
              <tr key={p.number} className="border-t bg-muted/30">
                <th scope="row" className="sticky left-0 z-10 bg-muted/30 px-2 py-1 text-left text-xs font-normal text-muted-foreground">
                  {p.startTime}–{p.endTime}
                </th>
                <td colSpan={SCHOOL_DAYS.length} className="px-2 py-1 text-center text-xs uppercase tracking-wide text-muted-foreground">
                  {p.label}
                </td>
              </tr>
            ) : (
              <tr key={p.number} className="border-t">
                <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-2 text-left align-top font-normal">
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.startTime}–{p.endTime}
                  </span>
                </th>
                {SCHOOL_DAYS.map((d) => {
                  const lesson = byKey.get(`${d}:${p.number}`) ?? null;
                  return (
                    <td key={d} className={cn("h-16 border-l px-1.5 py-1 align-top", today === d && "bg-primary/5")}>
                      {renderCell ? (
                        renderCell(d, p, lesson)
                      ) : lesson ? (
                        <LessonText lesson={lesson} show={show} />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LessonText({ lesson, show }: { lesson: LessonView; show: "teacher" | "section" }) {
  return (
    <div className="leading-tight">
      <p className="font-medium">{lesson.subject}</p>
      <p className="text-xs text-muted-foreground">{show === "teacher" ? lesson.teacher : lesson.section}</p>
      {lesson.room ? <p className="text-xs text-muted-foreground">{lesson.room}</p> : null}
    </div>
  );
}
