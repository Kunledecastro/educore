"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Label } from "@educore/ui/label";
import { Select } from "@educore/ui/select";
import { FormDialog } from "@/components/form/form-dialog";
import { LessonText, TimetableGrid } from "@/components/timetable/timetable-grid";
import type { LessonView, PeriodView } from "@/lib/timetable-data";
import { clearLesson, saveLesson } from "./actions";

type Assignment = { id: string; subjectId: string; label: string; subject: string; teacher: string };
type Slot = { day: number; period: PeriodView; lesson: LessonView | null };

/** A section's week, editable: click a slot to place or change a lesson. */
export function SectionEditor({
  sectionId,
  sectionLabel,
  periods,
  lessons,
  days,
  assignments,
  today,
}: {
  sectionId: string;
  sectionLabel: string;
  periods: PeriodView[];
  lessons: LessonView[];
  days: Record<number, string>;
  assignments: Assignment[];
  today?: number;
}) {
  const t = useTranslations("timetable");
  const [slot, setSlot] = React.useState<Slot | null>(null);

  return (
    <>
      <TimetableGrid
        periods={periods}
        lessons={lessons}
        days={days}
        caption={t("sectionCaption", { section: sectionLabel })}
        show="teacher"
        today={today}
        breakLabel={t("period")}
        renderCell={(day, period, lesson) => (
          <button
            type="button"
            onClick={() => setSlot({ day, period, lesson })}
            className="h-full min-h-14 w-full rounded-md p-1 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring print:pointer-events-none"
            aria-label={
              lesson
                ? t("editSlot", { day: days[day] ?? "", period: period.label, subject: lesson.subject })
                : t("addSlot", { day: days[day] ?? "", period: period.label })
            }
          >
            {lesson ? (
              <LessonText lesson={lesson} show="teacher" />
            ) : (
              <span className="flex h-full items-center justify-center text-muted-foreground/60 print:hidden">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
          </button>
        )}
      />
      <FormDialog
        title={slot ? t("slotTitle", { section: sectionLabel, day: days[slot.day] ?? "", period: slot.period.label, time: `${slot.period.startTime}–${slot.period.endTime}` }) : ""}
        open={slot !== null}
        onOpenChange={(o) => !o && setSlot(null)}
      >
        {(close) =>
          slot ? (
            <LessonForm
              key={`${slot.day}:${slot.period.number}`}
              sectionId={sectionId}
              slot={slot}
              assignments={assignments}
              onDone={() => {
                close();
                setSlot(null);
              }}
            />
          ) : null
        }
      </FormDialog>
    </>
  );
}

function LessonForm({ sectionId, slot, assignments, onDone }: { sectionId: string; slot: Slot; assignments: Assignment[]; onDone: () => void }) {
  const t = useTranslations("timetable");
  const tc = useTranslations("common");
  const router = useRouter();
  const current = slot.lesson ? assignments.find((a) => a.subject === slot.lesson!.subject && a.teacher === slot.lesson!.teacher) : undefined;
  const [assignmentId, setAssignmentId] = React.useState(current?.id ?? assignments[0]?.id ?? "");
  const [room, setRoom] = React.useState(slot.lesson?.room ?? "");
  const [pending, startTransition] = React.useTransition();
  const [confirmClear, setConfirmClear] = React.useState(false);
  const ids = { sectionId, dayOfWeek: slot.day, period: slot.period.number };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(success);
        router.refresh();
        onDone();
      } else toast.error((result as { error: string }).error);
    });

  if (assignments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noAssignments")}</p>;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveLesson({ ...ids, assignmentId, room }), t("saved"));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="lesson-assignment">{t("subjectTeacher")}</Label>
        <Select id="lesson-assignment" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} autoFocus>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t("subjectTeacherHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lesson-room">{t("room")}</Label>
        <Input id="lesson-room" value={room} maxLength={40} placeholder={t("roomPlaceholder")} onChange={(e) => setRoom(e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        {slot.lesson ? (
          <Button
            type="button"
            variant={confirmClear ? "destructive" : "outline"}
            className={confirmClear ? undefined : "text-destructive"}
            disabled={pending}
            onClick={() => (confirmClear ? run(() => clearLesson(ids), t("cleared")) : setConfirmClear(true))}
          >
            {confirmClear ? t("clearConfirm") : t("clear")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !assignmentId}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
