"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { useServerForm } from "@/components/form/use-server-form";
import { DEFAULT_PERIODS } from "@/lib/timetable";
import { savePeriods, type PeriodsInput } from "../actions";

type Row = { label: string; startTime: string; endTime: string; isBreak: boolean };

// Client-side shape check only; times, overlaps and "in use" are checked on save (same rules as the server).
const formSchema = z.object({
  rows: z.array(z.object({ label: z.string(), startTime: z.string(), endTime: z.string(), isBreak: z.boolean() })).min(1),
});

export function PeriodsEditor({ initial, isNew }: { initial: Row[]; isNew: boolean }) {
  const t = useTranslations("timetable.periods");
  const tc = useTranslations("common");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<PeriodsInput>({
    schema: formSchema,
    defaultValues: { rows: isNew ? DEFAULT_PERIODS.map((p) => ({ ...p })) : initial },
    submit: (values) => savePeriods(values),
    successMessage: t("saved"),
    onSuccess: () => router.refresh(),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rows" });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {isNew ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("startingPoint")}</p> : null}
      <div className="rounded-lg border">
        <div className="hidden grid-cols-[1fr_7rem_7rem_6rem_2.5rem] gap-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>{t("label")}</span>
          <span>{t("start")}</span>
          <span>{t("end")}</span>
          <span>{t("isBreak")}</span>
          <span className="sr-only">{tc("delete")}</span>
        </div>
        <ul className="divide-y">
          {fields.map((field, i) => {
            const err = fieldError(`rows.${i}.startTime`) ?? fieldError(`rows.${i}.label`);
            return (
              <li key={field.id} className="grid grid-cols-2 items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_7rem_7rem_6rem_2.5rem] sm:gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`p-label-${i}`}>{t("label")}</label>
                  <Input id={`p-label-${i}`} maxLength={20} {...form.register(`rows.${i}.label`)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`p-start-${i}`}>{t("start")}</label>
                  <Input id={`p-start-${i}`} type="time" step={300} {...form.register(`rows.${i}.startTime`)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`p-end-${i}`}>{t("end")}</label>
                  <Input id={`p-end-${i}`} type="time" step={300} {...form.register(`rows.${i}.endTime`)} />
                </div>
                <label className="flex items-center gap-2 text-sm" htmlFor={`p-break-${i}`}>
                  <input id={`p-break-${i}`} type="checkbox" className="h-4 w-4 accent-primary" {...form.register(`rows.${i}.isBreak`)} />
                  <span className="sm:sr-only">{t("isBreak")}</span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 justify-self-end text-destructive hover:text-destructive"
                  onClick={() => remove(i)}
                  disabled={fields.length <= 1}
                  aria-label={`${tc("delete")}: ${t("periodN", { n: i + 1 })}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
                {err ? <p className="col-span-full text-xs text-destructive">{err}</p> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" size="sm" disabled={fields.length >= 16} onClick={() => append({ label: "", startTime: "", endTime: "", isBreak: false })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : t("save")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("orderNote")}</p>
    </form>
  );
}
