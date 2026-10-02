"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button, buttonVariants } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Textarea } from "@educore/ui/textarea";
import type { CardState } from "@/lib/report-card";
import { MAX_COMMENT_LENGTH } from "@/lib/report-card";
import { saveComments } from "../actions";

type Row = {
  studentId: string;
  name: string;
  admissionNo: string;
  average: string;
  teacherComment: string;
  principalComment: string;
  state: CardState;
  cardId: string | null;
};

const STATE_BADGE = { notGenerated: "outline", ready: "success", outdated: "warning" } as const;

/**
 * Comments for every student in the section, saved together. Form teachers
 * edit the teacher's comment; admins also edit the principal's comment
 * (with a one-click "fill all blanks"). Shows each card's state and a
 * download link once generated.
 */
export function CommentsEditor({ sectionId, termId, isAdmin, rows }: { sectionId: string; termId: string; isAdmin: boolean; rows: Row[] }) {
  const t = useTranslations("reportCards");
  const router = useRouter();
  const initial = React.useMemo(
    () => Object.fromEntries(rows.map((r) => [r.studentId, { teacher: r.teacherComment, principal: r.principalComment }])),
    [rows],
  );
  const [draft, setDraft] = React.useState(initial);
  const [bulk, setBulk] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const changed = rows.filter(
    (r) => draft[r.studentId]!.teacher.trim() !== initial[r.studentId]!.teacher.trim() || draft[r.studentId]!.principal.trim() !== initial[r.studentId]!.principal.trim(),
  );
  const dirty = changed.length > 0;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (id: string, field: "teacher" | "principal", value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, [field]: value.slice(0, MAX_COMMENT_LENGTH) } }));

  const save = () =>
    startTransition(async () => {
      const result = await saveComments({
        sectionId,
        termId,
        rows: changed.map((r) => ({
          studentId: r.studentId,
          teacherComment: draft[r.studentId]!.teacher,
          ...(isAdmin ? { principalComment: draft[r.studentId]!.principal } : {}),
        })),
      });
      if (result.ok) {
        toast.success(result.data.changed === 0 ? t("noChanges") : t("saved", { count: result.data.changed }));
        router.refresh();
      } else toast.error(result.error);
    });

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row">
          <label htmlFor="bulk-principal" className="sr-only">
            {t("applyAllPlaceholder")}
          </label>
          <Input id="bulk-principal" value={bulk} maxLength={MAX_COMMENT_LENGTH} placeholder={t("applyAllPlaceholder")} onChange={(e) => setBulk(e.target.value)} />
          <Button
            type="button"
            variant="outline"
            disabled={!bulk.trim()}
            onClick={() =>
              setDraft((d) =>
                Object.fromEntries(Object.entries(d).map(([id, v]) => [id, v.principal.trim() ? v : { ...v, principal: bulk.trim() }])),
              )
            }
          >
            {t("applyAll")}
          </Button>
        </div>
      ) : null}

      <ul className="divide-y rounded-lg border">
        {rows.map((r) => {
          const d = draft[r.studentId]!;
          return (
            <li key={r.studentId} className="grid gap-3 p-3 lg:grid-cols-[14rem_1fr_1fr]">
              <div className="space-y-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.admissionNo} · {t("average")}: {r.average}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATE_BADGE[r.state]}>{t(`state.${r.state}`)}</Badge>
                  {r.state !== "notGenerated" && r.cardId ? (
                    <a
                      href={`/api/report-cards/${r.cardId}`}
                      className={buttonVariants({ variant: "ghost", size: "sm", className: "h-7 px-2" })}
                      aria-label={t("downloadFor", { name: r.name })}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("download")}
                    </a>
                  ) : null}
                </div>
              </div>
              <div>
                <label htmlFor={`tc-${r.studentId}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("teacherComment")}
                </label>
                <Textarea
                  id={`tc-${r.studentId}`}
                  rows={3}
                  value={d.teacher}
                  maxLength={MAX_COMMENT_LENGTH}
                  placeholder={t("teacherPlaceholder")}
                  onChange={(e) => set(r.studentId, "teacher", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`pc-${r.studentId}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("principalComment")}
                </label>
                {isAdmin ? (
                  <Textarea
                    id={`pc-${r.studentId}`}
                    rows={3}
                    value={d.principal}
                    maxLength={MAX_COMMENT_LENGTH}
                    placeholder={t("principalPlaceholder")}
                    onChange={(e) => set(r.studentId, "principal", e.target.value)}
                  />
                ) : (
                  <p id={`pc-${r.studentId}`} className="min-h-[4.5rem] rounded-md border bg-muted/40 p-2 text-sm text-muted-foreground">
                    {d.principal || t("readOnlyPrincipal")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        {dirty ? <span className="text-sm text-muted-foreground">{t("unsaved")}</span> : null}
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? t("saving") : t("saveComments")}
        </Button>
      </div>
    </div>
  );
}
