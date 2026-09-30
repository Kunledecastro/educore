"use client";

import * as React from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { useServerForm } from "@/components/form/use-server-form";
import { bandRanges, DEFAULT_GRADE_BANDS, validateGradeBands } from "@/lib/grading";
import { gradeBandsFormSchema, MAX_GRADE_BANDS, type GradeBandsInput } from "@/lib/validation/settings";
import { saveGradeBands } from "../actions";

type Row = { minScore: string; grade: string; remark: string };

const defaults = (): Row[] => DEFAULT_GRADE_BANDS.map((b) => ({ minScore: String(b.minScore), grade: b.grade, remark: b.remark ?? "" }));

/**
 * Edit the whole scale at once, then save. A live preview shows the score
 * range each grade will cover, and the same rules the server enforces
 * (a band from 0, no repeats) are checked as you type.
 */
export function GradingEditor({ initial, isNew }: { initial: Row[]; isNew: boolean }) {
  const t = useTranslations("settings.grading");
  const tc = useTranslations("common");
  const { form, onSubmit, pending, fieldError } = useServerForm<GradeBandsInput>({
    schema: gradeBandsFormSchema,
    defaultValues: { rows: isNew ? defaults() : initial },
    submit: (values) => saveGradeBands(values),
    successMessage: t("saved"),
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "rows" });
  const rows = (useWatch({ control: form.control, name: "rows" }) ?? []) as Row[];

  const parsed = rows.map((r) => ({ minScore: Number(r.minScore), grade: r.grade ?? "", remark: r.remark }));
  const usable = parsed.every((r) => r.grade.trim() && Number.isFinite(r.minScore) && r.minScore >= 0 && r.minScore <= 100);
  const issues = usable ? validateGradeBands(parsed) : [];
  const preview = usable && issues.length === 0 ? bandRanges(parsed) : [];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {isNew ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("startingPoint")}</p> : null}

      <div className="rounded-lg border">
        <div className="hidden grid-cols-[7rem_6rem_1fr_2.5rem] gap-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>{t("minScore")}</span>
          <span>{t("grade")}</span>
          <span>{t("remark")}</span>
          <span className="sr-only">{tc("delete")}</span>
        </div>
        <ul className="divide-y">
          {fields.map((field, i) => {
            const minErr = fieldError(`rows.${i}.minScore`);
            const gradeErr = fieldError(`rows.${i}.grade`);
            const remarkErr = fieldError(`rows.${i}.remark`);
            return (
              <li key={field.id} className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 px-3 py-2 sm:grid-cols-[7rem_6rem_1fr_2.5rem] sm:gap-3">
                <div>
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`band-min-${i}`}>
                    {t("minScore")}
                  </label>
                  <Input
                    id={`band-min-${i}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.1"
                    aria-invalid={minErr ? true : undefined}
                    aria-describedby={minErr ? `band-min-${i}-error` : undefined}
                    {...form.register(`rows.${i}.minScore`)}
                  />
                  {minErr ? (
                    <p id={`band-min-${i}-error`} className="mt-1 text-xs text-destructive">
                      {minErr}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`band-grade-${i}`}>
                    {t("grade")}
                  </label>
                  <Input
                    id={`band-grade-${i}`}
                    maxLength={8}
                    aria-invalid={gradeErr ? true : undefined}
                    aria-describedby={gradeErr ? `band-grade-${i}-error` : undefined}
                    {...form.register(`rows.${i}.grade`)}
                  />
                  {gradeErr ? (
                    <p id={`band-grade-${i}-error`} className="mt-1 text-xs text-destructive">
                      {gradeErr}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`band-remark-${i}`}>
                    {t("remark")}
                  </label>
                  <Input id={`band-remark-${i}`} maxLength={60} placeholder={t("remarkPlaceholder")} {...form.register(`rows.${i}.remark`)} />
                  {remarkErr ? <p className="mt-1 text-xs text-destructive">{remarkErr}</p> : null}
                </div>
                <div className="col-start-3 row-start-1 flex items-end sm:col-start-auto sm:row-start-auto sm:items-start">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-destructive hover:text-destructive"
                    onClick={() => remove(i)}
                    disabled={fields.length <= 1}
                    aria-label={`${tc("delete")}: ${rows[i]?.grade || t("band", { n: i + 1 })}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_GRADE_BANDS}
          onClick={() => append({ minScore: "", grade: "", remark: "" })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("addBand")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => replace(defaults())}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t("useDefault")}
        </Button>
      </div>

      <section aria-labelledby="scale-preview" className="rounded-md border p-4">
        <h2 id="scale-preview" className="mb-2 text-sm font-medium">
          {t("preview")}
        </h2>
        {preview.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm" aria-live="polite">
            {preview.map((b) => (
              <li key={b.grade} className="rounded-md bg-muted px-2 py-1 tabular-nums">
                <span className="font-semibold">{b.grade}</span> {t("range", { min: b.minScore, max: b.maxScore })}
                {b.remark ? <span className="text-muted-foreground"> · {b.remark}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {issues.some((i) => i.code === "noZeroBand") ? t("errors.noZeroBand") : t("previewUnavailable")}
          </p>
        )}
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
