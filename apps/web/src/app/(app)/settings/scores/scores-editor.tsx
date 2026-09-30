"use client";

import * as React from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { cn } from "@educore/ui/utils";
import { useServerForm } from "@/components/form/use-server-form";
import { DEFAULT_SCORE_COMPONENTS, roundScore } from "@/lib/grading";
import { MAX_SCORE_COMPONENTS, scoreComponentsFormSchema, type ScoreComponentsInput } from "@/lib/validation/settings";
import { saveScoreComponents } from "../actions";

type Row = { id?: string; name: string; weight: string; inUse?: boolean };

/**
 * Score components (confirmed decision 2): e.g. CA1 20 + CA2 20 + Exam 60.
 * A running total shows whether they add up to 100. A component that
 * already has scores recorded can be renamed or re-weighted, never removed.
 */
export function ScoresEditor({ initial, isNew }: { initial: Row[]; isNew: boolean }) {
  const t = useTranslations("settings.scores");
  const tc = useTranslations("common");
  const inUse = React.useMemo(() => new Set(initial.filter((r) => r.inUse).map((r) => r.id)), [initial]);
  const { form, onSubmit, pending, fieldError } = useServerForm<ScoreComponentsInput>({
    schema: scoreComponentsFormSchema,
    defaultValues: {
      rows: isNew ? DEFAULT_SCORE_COMPONENTS.map((c) => ({ name: c.name, weight: String(c.weight) })) : initial.map(({ inUse: _u, ...r }) => r),
    },
    submit: (values) => saveScoreComponents(values),
    successMessage: t("saved"),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rows" });
  const rows = (useWatch({ control: form.control, name: "rows" }) ?? []) as Row[];
  const total = roundScore(rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0), 0));
  const ok = total === 100;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {isNew ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("startingPoint")}</p> : null}

      <ul className="divide-y rounded-lg border">
        {fields.map((field, i) => {
          const locked = Boolean(rows[i]?.id && inUse.has(rows[i]!.id));
          const nameErr = fieldError(`rows.${i}.name`);
          const weightErr = fieldError(`rows.${i}.weight`);
          return (
            <li key={field.id} className="grid grid-cols-[1fr_6.5rem_2.5rem] items-start gap-2 px-3 py-2 sm:gap-3">
              <input type="hidden" {...form.register(`rows.${i}.id`)} />
              <div>
                <label className="sr-only" htmlFor={`comp-name-${i}`}>
                  {t("name")}
                </label>
                <Input
                  id={`comp-name-${i}`}
                  maxLength={30}
                  placeholder={t("namePlaceholder")}
                  aria-invalid={nameErr ? true : undefined}
                  {...form.register(`rows.${i}.name`)}
                />
                {nameErr ? <p className="mt-1 text-xs text-destructive">{nameErr}</p> : null}
              </div>
              <div>
                <label className="sr-only" htmlFor={`comp-weight-${i}`}>
                  {t("weight")}
                </label>
                <div className="relative">
                  <Input
                    id={`comp-weight-${i}`}
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={100}
                    step="0.1"
                    className="pr-12"
                    aria-invalid={weightErr ? true : undefined}
                    {...form.register(`rows.${i}.weight`)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {t("marks")}
                  </span>
                </div>
                {weightErr ? <p className="mt-1 text-xs text-destructive">{weightErr}</p> : null}
              </div>
              {locked ? (
                <span className="flex h-10 w-10 items-center justify-center text-muted-foreground" title={t("lockedHint")}>
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t("lockedHint")}</span>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-destructive hover:text-destructive"
                  onClick={() => remove(i)}
                  disabled={fields.length <= 1}
                  aria-label={`${tc("delete")}: ${rows[i]?.name || t("component", { n: i + 1 })}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_SCORE_COMPONENTS}
          onClick={() => append({ name: "", weight: "" })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
        </Button>
        <p className={cn("text-sm font-medium tabular-nums", ok ? "text-success" : "text-destructive")} aria-live="polite">
          {ok ? t("totalOk") : t("totalOff", { total })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !ok}>
          {pending ? tc("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
