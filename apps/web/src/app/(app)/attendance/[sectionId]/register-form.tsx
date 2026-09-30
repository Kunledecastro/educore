"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { cn } from "@educore/ui/utils";
import { ATTENDANCE_STATUSES, summarizeAttendance, type AttendanceStatusValue } from "@/lib/attendance";
import { saveRegister } from "../actions";

type StudentRow = { id: string; name: string; admissionNo: string; status: AttendanceStatusValue | null; remark: string };

const STATUS_STYLE: Record<AttendanceStatusValue, string> = {
  PRESENT: "peer-checked:bg-success peer-checked:text-success-foreground peer-checked:border-success",
  ABSENT: "peer-checked:bg-destructive peer-checked:text-destructive-foreground peer-checked:border-destructive",
  LATE: "peer-checked:bg-warning peer-checked:text-warning-foreground peer-checked:border-warning",
  EXCUSED: "peer-checked:bg-secondary peer-checked:text-secondary-foreground peer-checked:border-foreground/30",
};

/**
 * The daily register. Each student is a radio group (arrow keys move
 * between statuses; one tap on a phone). "Mark all present" is the usual
 * start, then change the few who aren't. Leaving with unsaved changes asks
 * first.
 */
export function RegisterForm({
  sectionId,
  date,
  dateLabel,
  readOnly,
  students,
}: {
  sectionId: string;
  date: string;
  dateLabel: string;
  readOnly: boolean;
  students: StudentRow[];
}) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const initial = React.useMemo(() => Object.fromEntries(students.map((s) => [s.id, { status: s.status, remark: s.remark }])), [students]);
  const [rows, setRows] = React.useState(initial);
  const [openRemarks, setOpenRemarks] = React.useState<Set<string>>(() => new Set(students.filter((s) => s.remark).map((s) => s.id)));
  const [pending, startTransition] = React.useTransition();

  const dirty = students.some((s) => rows[s.id]!.status !== initial[s.id]!.status || rows[s.id]!.remark.trim() !== initial[s.id]!.remark.trim());
  const statuses = students.map((s) => rows[s.id]!.status).filter((x): x is AttendanceStatusValue => x !== null);
  const summary = summarizeAttendance(statuses);
  const unmarked = students.length - statuses.length;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (id: string, patch: Partial<{ status: AttendanceStatusValue | null; remark: string }>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));

  const save = () =>
    startTransition(async () => {
      const entries = students
        .filter((s) => rows[s.id]!.status)
        .map((s) => ({ studentId: s.id, status: rows[s.id]!.status!, remark: rows[s.id]!.remark }));
      const result = await saveRegister({ sectionId, date, entries });
      if (result.ok) {
        const { created, updated } = result.data;
        toast.success(created + updated === 0 ? t("noChanges") : t("saved", { count: created + updated }));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <p className="text-sm" aria-live="polite">
          {t("tally", { present: summary.present, absent: summary.absent, late: summary.late, excused: summary.excused })}
          {unmarked > 0 ? <span className="text-muted-foreground"> · {t("unmarked", { count: unmarked })}</span> : null}
        </p>
        {!readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([id, v]) => [id, { ...v, status: "PRESENT" as const }])))}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {t("markAllPresent")}
          </Button>
        ) : null}
      </div>

      <ul className="divide-y rounded-lg border" aria-label={t("registerFor", { date: dateLabel })}>
        {students.map((s) => {
          const row = rows[s.id]!;
          const groupId = `att-${s.id}`;
          const remarkOpen = openRemarks.has(s.id);
          return (
            <li key={s.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="font-medium" id={`${groupId}-label`}>
                  {s.name}
                </p>
                <p className="text-xs text-muted-foreground">{s.admissionNo}</p>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="flex flex-wrap gap-1">
                  {ATTENDANCE_STATUSES.map((status) => (
                    <label key={status} className="relative">
                      <input
                        type="radio"
                        name={groupId}
                        value={status}
                        checked={row.status === status}
                        disabled={readOnly}
                        onChange={() => set(s.id, { status })}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "inline-flex h-9 min-w-[4.75rem] cursor-pointer select-none items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors",
                          "hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                          "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                          STATUS_STYLE[status],
                        )}
                      >
                        {t(`status.${status}`)}
                      </span>
                    </label>
                  ))}
                  {!readOnly && !remarkOpen ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setOpenRemarks((o) => new Set(o).add(s.id))}
                      aria-label={`${t("addRemark")}: ${s.name}`}
                    >
                      <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
                {remarkOpen ? (
                  <div className="w-full md:w-80">
                    <label htmlFor={`${groupId}-remark`} className="sr-only">
                      {t("remarkFor", { name: s.name })}
                    </label>
                    <Input
                      id={`${groupId}-remark`}
                      value={row.remark}
                      maxLength={200}
                      disabled={readOnly}
                      placeholder={t("remarkPlaceholder")}
                      onChange={(e) => set(s.id, { remark: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          {dirty ? <span className="text-sm text-muted-foreground">{t("unsaved")}</span> : null}
          <Button type="button" onClick={save} disabled={pending || statuses.length === 0}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
