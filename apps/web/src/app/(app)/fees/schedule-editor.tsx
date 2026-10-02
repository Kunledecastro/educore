"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { cn } from "@educore/ui/utils";
import { useServerForm } from "@/components/form/use-server-form";
import { toMinor } from "@/lib/fees";
import type { ScheduleInput } from "@/lib/validation/fees";
import { saveSchedule } from "./actions";

type Item = { id: string; name: string; isOptional: boolean; isOneOff: boolean; isActive: boolean };
type ClassCol = { id: string; name: string; students: number };

// Client-side shape check only; amounts are checked on save with the same rules as the server.
const formSchema = z.object({ termId: z.string(), rows: z.array(z.object({ feeTypeId: z.string(), classId: z.string(), amount: z.string() })) });

/**
 * Items down the side, classes across: type each class's amount per item for
 * the term. Blank = not charged. Totals show what a student pays before
 * optional items and discounts. Scrolls sideways on phones.
 */
export function ScheduleEditor({
  termId,
  termName,
  items,
  classes,
  amounts,
  currency,
  locale,
  readOnly,
}: {
  termId: string;
  termName: string;
  items: Item[];
  classes: ClassCol[];
  amounts: Record<string, string>;
  currency: string;
  locale: string;
  readOnly: boolean;
}) {
  const t = useTranslations("fees.schedule");
  const tc = useTranslations("common");
  const router = useRouter();
  const money = React.useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }), [locale, currency]);
  const plain = (v: string | undefined) => {
    if (!v) return "";
    const minor = toMinor(v);
    if (minor === null) return v;
    return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
  };
  const cells = items.flatMap((item) => classes.map((c) => ({ feeTypeId: item.id, classId: c.id, amount: plain(amounts[`${item.id}:${c.id}`]) })));
  const index = (i: number, c: number) => i * classes.length + c;

  const { form, onSubmit, pending, fieldError } = useServerForm<ScheduleInput>({
    schema: formSchema,
    defaultValues: { termId, rows: cells },
    submit: (values) => saveSchedule(values),
    successMessage: t("saved", { term: termName }),
    onSuccess: () => router.refresh(),
  });
  const rows = form.watch("rows");
  const dirty = form.formState.isDirty;

  const totals = classes.map((_, c) => {
    let compulsory = 0;
    let optional = 0;
    items.forEach((item, i) => {
      const minor = toMinor(rows[index(i, c)]?.amount ?? "") ?? 0;
      if (item.isOptional) optional += minor;
      else compulsory += minor;
    });
    return { compulsory, optional };
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <input type="hidden" {...form.register("termId")} />
      <p className="text-sm text-muted-foreground">{readOnly ? t("readOnlyHint") : t("hint")}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">{t("caption", { term: termName })}</caption>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="sticky left-0 z-10 min-w-44 bg-muted/50 px-3 py-2 text-left font-medium">
                {t("item")}
              </th>
              {classes.map((c) => (
                <th key={c.id} scope="col" className="min-w-32 px-2 py-2 text-left font-medium">
                  {c.name}
                  <span className="block text-xs font-normal text-muted-foreground">{t("students", { count: c.students })}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className={cn("border-t", !item.isActive && "opacity-60")}>
                <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left align-middle font-normal">
                  <span className="font-medium">{item.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {item.isOptional ? <Badge variant="secondary">{t("optional")}</Badge> : null}
                    {item.isOneOff ? <Badge variant="secondary">{t("oneOff")}</Badge> : null}
                    {!item.isActive ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                  </span>
                </th>
                {classes.map((c, ci) => {
                  const k = index(i, ci);
                  const err = fieldError(`rows.${k}.amount`);
                  return (
                    <td key={c.id} className="border-l px-2 py-1.5 align-top">
                      <Input
                        aria-label={t("cellLabel", { item: item.name, class: c.name })}
                        aria-invalid={err ? true : undefined}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="—"
                        disabled={readOnly}
                        className={cn("h-9 text-right tabular-nums", err && "border-destructive")}
                        {...form.register(`rows.${k}.amount`)}
                      />
                      {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <th scope="row" className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-medium">
                {t("total")}
                <span className="block text-xs font-normal text-muted-foreground">{t("totalHint")}</span>
              </th>
              {totals.map((tot, ci) => (
                <td key={classes[ci]!.id} className="border-l px-2 py-2 text-right tabular-nums">
                  <span className="font-semibold">{money.format(tot.compulsory / 100)}</span>
                  {tot.optional > 0 ? <span className="block text-xs text-muted-foreground">{t("plusOptional", { amount: money.format(tot.optional / 100) })}</span> : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty ? <span className="text-sm text-muted-foreground">{t("unsaved")}</span> : null}
          <Button type="button" variant="ghost" disabled={pending || !dirty} onClick={() => form.reset()}>
            {t("discard")}
          </Button>
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? tc("saving") : t("save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
