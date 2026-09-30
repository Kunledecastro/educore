"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { cn } from "@educore/ui/utils";
import type { GradeBandInput } from "@/lib/grading";
import { gradeForTotal, isValidScore, stats, subjectTotal } from "@/lib/results";
import { readScoresFile, saveScores } from "../../actions";

type Component = { id: string; name: string; weight: number; maxScore: number };
type Row = { id: string; name: string; admissionNo: string; scores: Record<string, number | null> };
/** Cell text as typed; "" = no score. */
type Draft = Record<string, Record<string, string>>;

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/**
 * Gradebook grid: students × score components. Totals, grades and class
 * statistics update as you type, using the same maths as the server
 * (lib/results.ts). Enter moves down a column, like a spreadsheet. Invalid
 * cells are marked and block saving. A score file can be read into the
 * grid first; nothing is stored until you save.
 */
export function GradebookGrid({
  sectionId,
  subjectId,
  termId,
  readOnly,
  components,
  bands,
  rows,
}: {
  sectionId: string;
  subjectId: string;
  termId: string;
  readOnly: boolean;
  components: Component[];
  bands: GradeBandInput[];
  rows: Row[];
}) {
  const t = useTranslations("gradebook");
  const router = useRouter();
  const initial = React.useMemo<Draft>(
    () => Object.fromEntries(rows.map((r) => [r.id, Object.fromEntries(components.map((c) => [c.id, fmt(r.scores[c.id])]))])),
    [rows, components],
  );
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [pending, startTransition] = React.useTransition();
  const [importIssues, setImportIssues] = React.useState<{ row: number; message: string }[] | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const parse = (text: string): number | null | "invalid" => {
    const v = text.trim().replace(",", ".");
    if (v === "") return null;
    if (!/^\d+(\.\d+)?$/.test(v)) return "invalid";
    return Number(v);
  };
  const cellError = (c: Component, text: string) => {
    const v = parse(text);
    return v === "invalid" || (v !== null && !isValidScore(v, c.maxScore));
  };

  const changed = rows.flatMap((r) =>
    components.filter((c) => draft[r.id]![c.id]!.trim() !== initial[r.id]![c.id]!.trim()).map((c) => ({ r, c })),
  );
  const invalid = rows.some((r) => components.some((c) => cellError(c, draft[r.id]![c.id]!)));
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

  const computed = rows.map((r) => {
    const total = subjectTotal(
      components.map((c) => {
        const v = parse(draft[r.id]![c.id]!);
        return { weight: c.weight, maxScore: c.maxScore, score: typeof v === "number" && isValidScore(v, c.maxScore) ? v : null };
      }),
    );
    return { id: r.id, total, grade: gradeForTotal(total, bands) };
  });
  const totalStats = stats(computed.map((x) => (x.total.complete ? x.total.total : null)));
  const componentStats = components.map((c) =>
    stats(rows.map((r) => {
      const v = parse(draft[r.id]![c.id]!);
      return typeof v === "number" ? v : null;
    })),
  );

  const save = () =>
    startTransition(async () => {
      const cells = changed.map(({ r, c }) => {
        const v = parse(draft[r.id]![c.id]!);
        return { studentId: r.id, componentId: c.id, score: v === "invalid" ? null : v };
      });
      const result = await saveScores({ sectionId, subjectId, termId, cells });
      if (result.ok) {
        const n = result.data.created + result.data.updated + result.data.cleared;
        toast.success(n === 0 ? t("noChanges") : t("saved", { count: n }));
        setImportIssues(null);
        router.refresh();
      } else toast.error(result.error);
    });

  const importFile = (file: File) =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("sectionId", sectionId);
      fd.set("subjectId", subjectId);
      fd.set("termId", termId);
      const result = await readScoresFile(fd);
      if (fileRef.current) fileRef.current.value = "";
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft((d) => {
        const next = structuredClone(d);
        for (const cell of result.data.cells) next[cell.studentId]![cell.componentId] = String(cell.score);
        return next;
      });
      setImportIssues(result.data.issues);
      toast.success(t("import.filled", { count: result.data.cells.length }));
    });

  /** Enter / Shift+Enter move down / up the column, like a spreadsheet. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = document.getElementById(`cell-${rowIndex + (e.shiftKey ? -1 : 1)}-${colIndex}`);
    next?.focus();
  };

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              id="scores-file"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              {t("import.button")}
            </Button>
          </div>
        </div>
      ) : null}

      {importIssues && importIssues.length > 0 ? (
        <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="mb-1 font-medium">{t("import.issuesTitle", { count: importIssues.length })}</p>
          <ul className="list-inside list-disc space-y-0.5">
            {importIssues.slice(0, 20).map((i, n) => (
              <li key={n}>{i.row > 0 ? t("import.row", { row: i.row, message: i.message }) : i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
                {t("student")}
              </th>
              {components.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2 text-right font-medium">
                  {c.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {c.maxScore === c.weight ? t("outOf", { max: c.maxScore }) : t("outOfScaled", { max: c.maxScore, weight: c.weight })}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("total")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t("grade")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, ri) => {
              const x = computed[ri]!;
              return (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-normal">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.admissionNo}</span>
                  </th>
                  {components.map((c, ci) => {
                    const value = draft[r.id]![c.id]!;
                    const bad = cellError(c, value);
                    const isChanged = value.trim() !== initial[r.id]![c.id]!.trim();
                    return (
                      <td key={c.id} className="px-2 py-1.5 text-right">
                        <Input
                          id={`cell-${ri}-${ci}`}
                          inputMode="decimal"
                          value={value}
                          readOnly={readOnly}
                          aria-label={t("cellLabel", { student: r.name, component: c.name, max: c.maxScore })}
                          aria-invalid={bad ? true : undefined}
                          onKeyDown={(e) => onKeyDown(e, ri, ci)}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.id]: { ...d[r.id]!, [c.id]: e.target.value } }))}
                          className={cn(
                            "ml-auto h-9 w-20 text-right tabular-nums",
                            bad && "border-destructive focus-visible:ring-destructive",
                            isChanged && !bad && "border-primary",
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {x.total.total === null ? "—" : x.total.total}
                    {x.total.total !== null && !x.total.complete ? (
                      <span className="block text-xs text-muted-foreground">{t("incomplete")}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    {x.grade ? (
                      <>
                        <span className="font-semibold">{x.grade.grade}</span>
                        {x.grade.remark ? <span className="ml-1 text-xs text-muted-foreground">{x.grade.remark}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30 text-xs text-muted-foreground">
            {(["average", "highest", "lowest"] as const).map((k) => (
              <tr key={k}>
                <th scope="row" className="sticky left-0 bg-muted/30 px-3 py-1 text-left font-medium">
                  {t(`stats.${k}`)}
                </th>
                {componentStats.map((s, i) => (
                  <td key={components[i]!.id} className="px-2 py-1 text-right tabular-nums">
                    {fmt(s[k])}
                  </td>
                ))}
                <td className="px-3 py-1 text-right tabular-nums">{fmt(totalStats[k])}</td>
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      {!readOnly ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          {invalid ? <span className="text-sm text-destructive">{t("fixInvalid")}</span> : dirty ? <span className="text-sm text-muted-foreground">{t("unsaved", { count: changed.length })}</span> : null}
          <Button type="button" onClick={save} disabled={pending || !dirty || invalid}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
