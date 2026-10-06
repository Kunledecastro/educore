"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { markMissingAction, markSubmissionAction, recordWorkAction, releaseMarksAction, returnSubmissionAction } from "@/app/(app)/assignments/actions";
import type { MarkingState } from "@/lib/assignments/rules";
import { formatBytes } from "./file-upload";

export interface MarkingRowView {
  student: { id: string; name: string; admissionNo: string };
  state: MarkingState;
  submission: null | {
    id: string;
    text: string;
    submittedAt: string;
    isLate: boolean;
    score: number | null;
    feedback: string | null;
    submittedBy: "STUDENT" | "PARENT" | "STAFF";
    files: { id: string; fileName: string; sizeBytes: number }[];
  };
}

const STATE_VARIANT = { missing: "outline", submitted: "secondary", late: "warning", returned: "warning", marked: "success", notHandedIn: "destructive" } as const;
const FILTERS = ["all", "toMark", "missing", "marked"] as const;
type Filter = (typeof FILTERS)[number];

function matches(f: Filter, s: MarkingState) {
  if (f === "all") return true;
  if (f === "toMark") return s === "submitted" || s === "late";
  if (f === "missing") return s === "missing" || s === "notHandedIn";
  return s === "marked";
}

/** The teacher's marking view for one class (Phase 5.2). */
export function MarkingSheet({ assignmentId, rows, maxScore, canMark, mode, pastDue, released, title }: {
  assignmentId: string;
  rows: MarkingRowView[];
  maxScore: number | null;
  canMark: boolean;
  mode: "ONLINE" | "PAPER";
  pastDue: boolean;
  released: boolean;
  title: string;
}) {
  const t = useTranslations("assignments.marking");
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>(mode === "PAPER" ? "all" : "toMark");
  const counts = Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => matches(f, r.state)).length])) as Record<Filter, number>;
  const shown = rows.filter((r) => matches(filter, r.state));
  const noneYet = rows.filter((r) => r.state === "missing").length;

  return (
    <section className="space-y-4" aria-labelledby="marking-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="marking-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        {canMark ? (
          <div className="flex flex-wrap gap-2">
            {pastDue && noneYet > 0 ? (
              <ConfirmAction
                trigger={
                  <Button size="sm" variant="outline">
                    {t("markMissing", { count: noneYet })}
                  </Button>
                }
                title={t("markMissingTitle")}
                description={maxScore !== null ? t("markMissingScored", { count: noneYet }) : t("markMissingUnscored", { count: noneYet })}
                confirmLabel={t("markMissingConfirm")}
                action={() => markMissingAction(assignmentId)}
                successMessage={t("saved")}
                onSuccess={() => router.refresh()}
              />
            ) : null}
            {maxScore !== null ? (
              released ? (
                <ConfirmAction
                  trigger={
                    <Button size="sm" variant="outline">
                      {t("hideMarks")}
                    </Button>
                  }
                  title={t("hideTitle", { title })}
                  description={t("hideDescription")}
                  confirmLabel={t("hideMarks")}
                  destructive={false}
                  action={() => releaseMarksAction(assignmentId, false)}
                  successMessage={t("saved")}
                  onSuccess={() => router.refresh()}
                />
              ) : (
                <ConfirmAction
                  trigger={<Button size="sm">{t("release")}</Button>}
                  title={t("releaseTitle", { title })}
                  description={t("releaseDescription")}
                  confirmLabel={t("release")}
                  destructive={false}
                  action={() => releaseMarksAction(assignmentId, true)}
                  successMessage={t("released")}
                  onSuccess={() => router.refresh()}
                />
              )
            ) : null}
          </div>
        ) : null}
      </div>
      {maxScore !== null ? <p className="text-sm text-muted-foreground">{released ? t("releasedNote") : t("notReleasedNote")}</p> : null}

      <div role="tablist" aria-label={t("filter")} className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 ${filter === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t(`filters.${f}`, { count: counts[f] })}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("nothingHere")}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <MarkingItem key={r.student.id} row={r} assignmentId={assignmentId} maxScore={maxScore} canMark={canMark} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MarkingItem({ row, assignmentId, maxScore, canMark }: { row: MarkingRowView; assignmentId: string; maxScore: number | null; canMark: boolean }) {
  const t = useTranslations("assignments.marking");
  const router = useRouter();
  const sub = row.submission;
  const [score, setScore] = React.useState(sub?.score !== null && sub?.score !== undefined ? String(sub.score) : "");
  const [feedback, setFeedback] = React.useState(sub?.feedback ?? "");
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(row.state === "submitted" || row.state === "late");
  const id = `mk-${row.student.id}`;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "");
    });

  const scoreValue = score.trim() === "" ? "" : score;
  const mark = () => (sub ? run(() => markSubmissionAction(sub.id, { score: scoreValue, feedback }), t("saved")) : run(() => recordWorkAction(assignmentId, row.student.id, { score: scoreValue, feedback }), t("saved")));
  const giveBack = () => {
    if (!sub) return;
    if (!feedback.trim()) return toast.error(t("returnNeedsComment"));
    run(() => returnSubmissionAction(sub.id, { feedback }), t("returned"));
  };

  return (
    <li className="rounded-lg border bg-card">
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>
          <span className="font-medium">{row.student.name}</span> <span className="font-mono text-xs text-muted-foreground">{row.student.admissionNo}</span>
        </span>
        <span className="flex items-center gap-2">
          {sub?.score !== null && sub?.score !== undefined && maxScore !== null ? <span className="text-sm tabular-nums">{t("scoreOf", { score: sub.score, max: maxScore })}</span> : null}
          <Badge variant={STATE_VARIANT[row.state]}>{t(`states.${row.state}`)}</Badge>
        </span>
      </button>
      {open ? (
        <div id={id} className="space-y-4 border-t p-4">
          {sub && row.state !== "notHandedIn" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("handedIn", { when: sub.submittedAt })}
                {sub.submittedBy === "PARENT" ? ` · ${t("byParent")}` : sub.submittedBy === "STAFF" ? ` · ${t("byStaff")}` : ""}
              </p>
              {sub.text ? <p className="whitespace-pre-line rounded-md bg-muted p-3 text-sm">{sub.text}</p> : null}
              {sub.files.length ? (
                <ul className="space-y-1 text-sm">
                  {sub.files.map((f) => (
                    <li key={f.id}>
                      <a className="inline-flex items-center gap-2 underline-offset-2 hover:underline" href={`/api/assignments/files/${f.id}`} target="_blank" rel="noopener">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        {f.fileName} <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : !sub ? (
            <p className="text-sm text-muted-foreground">{t("nothingYet")}</p>
          ) : null}

          {canMark ? (
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              {maxScore !== null ? (
                <div className="space-y-1.5">
                  <label htmlFor={`${id}-score`} className="text-sm font-medium">
                    {t("score", { max: maxScore })}
                  </label>
                  <Input id={`${id}-score`} type="number" inputMode="decimal" min={0} max={maxScore} step={0.5} value={score} onChange={(e) => setScore(e.target.value)} />
                </div>
              ) : null}
              <div className="space-y-1.5 sm:col-start-2">
                <label htmlFor={`${id}-fb`} className="text-sm font-medium">
                  {t("comment")}
                </label>
                <Textarea id={`${id}-fb`} rows={2} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="button" size="sm" disabled={pending} onClick={mark}>
                  {sub ? (row.state === "marked" ? t("updateMark") : t("mark")) : t("record")}
                </Button>
                {sub && row.state !== "returned" ? (
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={giveBack}>
                    {row.state === "notHandedIn" ? t("allowLate") : t("giveBack")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
