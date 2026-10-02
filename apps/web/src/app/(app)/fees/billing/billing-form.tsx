"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Label } from "@educore/ui/label";
import { ConfirmAction } from "@/components/form/confirm-action";
import { startBillingRun } from "../invoice-actions";

type ClassRow = { id: string; name: string; students: number; billed: number; toBill: number; noFees: number; amount: string; amountMinor: number };

/** Choose classes and a due date, see what will be billed, start the run. */
export function BillingForm({
  termId,
  termName,
  defaultDueDate,
  busy,
  classes,
  currency,
  locale,
}: {
  termId: string;
  termName: string;
  defaultDueDate: string;
  busy: boolean;
  classes: ClassRow[];
  currency: string;
  locale: string;
}) {
  const t = useTranslations("fees.billing");
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(classes.filter((c) => c.toBill > 0).map((c) => c.id)));
  const [dueDate, setDueDate] = React.useState(defaultDueDate);
  const chosen = classes.filter((c) => selected.has(c.id));
  const count = chosen.reduce((n, c) => n + c.toBill, 0);
  const amount = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
    chosen.reduce((n, c) => n + c.amountMinor, 0) / 100,
  );
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const nothingLeft = classes.every((c) => c.toBill === 0);

  return (
    <div className="space-y-4">
      <fieldset className="rounded-lg border">
        <legend className="sr-only">{t("classesLegend")}</legend>
        <div className="hidden grid-cols-[1fr_6rem_6rem_7rem_9rem] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>{t("class")}</span>
          <span className="text-right">{t("students")}</span>
          <span className="text-right">{t("alreadyBilled")}</span>
          <span className="text-right">{t("toBill")}</span>
          <span className="text-right">{t("amount")}</span>
        </div>
        <ul className="divide-y">
          {classes.map((c) => (
            <li key={c.id}>
              <label htmlFor={`bill-${c.id}`} className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-accent/40 sm:grid-cols-[auto_1fr_6rem_6rem_7rem_9rem]">
                <input
                  id={`bill-${c.id}`}
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selected.has(c.id)}
                  disabled={c.toBill === 0 || busy}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                <span className="font-medium">
                  {c.name}
                  {c.noFees > 0 ? <span className="block text-xs font-normal text-destructive">{t("noFeesWarning", { count: c.noFees })}</span> : null}
                </span>
                <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm sm:text-foreground">
                  <span className="sm:hidden">{t("students")}: </span>
                  {c.students}
                </span>
                <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-right sm:text-sm sm:text-foreground">
                  <span className="sm:hidden">{t("alreadyBilled")}: </span>
                  {c.billed}
                </span>
                <span className="col-start-2 text-xs sm:col-start-auto sm:text-right sm:text-sm">
                  <span className="text-muted-foreground sm:hidden">{t("toBill")}: </span>
                  <span className="font-medium">{c.toBill}</span>
                </span>
                <span className="col-start-2 text-sm tabular-nums sm:col-start-auto sm:text-right">{c.amount}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {nothingLeft ? (
        <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("allBilled", { term: termName })}</p>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor="bill-due">{t("dueDate")}</Label>
            <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-48" />
          </div>
          <div className="space-y-2 sm:text-right">
            <p className="text-sm" aria-live="polite">
              {t("summary", { count, amount })}
            </p>
            <ConfirmAction
              trigger={
                <Button disabled={busy || count === 0 || !dueDate}>
                  {busy ? t("busyButton") : t("start", { count })}
                </Button>
              }
              title={t("confirmTitle", { count, term: termName })}
              description={t("confirmDescription", { amount })}
              confirmLabel={t("start", { count })}
              destructive={false}
              action={async () => {
                const result = await startBillingRun({ termId, classIds: [...selected], dueDate });
                if (result.ok) router.refresh();
                return result;
              }}
              successMessage={t("started")}
            />
          </div>
        </div>
      )}
      {busy ? <p className="text-sm text-muted-foreground">{t("busyHint")}</p> : null}
    </div>
  );
}
