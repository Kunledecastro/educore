"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Label } from "@educore/ui/label";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog } from "@/components/form/form-dialog";
import { copySchedule } from "./actions";

/** Fill this term's schedule from another term (replacing what's there, after confirmation). */
export function CopyScheduleButton({ toTerm, terms, hasAmounts }: { toTerm: { id: string; name: string }; terms: { id: string; name: string }[]; hasAmounts: boolean }) {
  const t = useTranslations("fees.schedule");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(terms[0]?.id ?? "");
  const fromName = terms.find((x) => x.id === from)?.name ?? "";
  return (
    <FormDialog
      title={t("copyTitle", { term: toTerm.name })}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t("copy")}
        </Button>
      }
    >
      {(close) => (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="copy-from">{t("copyFrom")}</Label>
            <Select id="copy-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {terms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t("copyHint")}</p>
          </div>
          {hasAmounts ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{t("copyReplaces", { term: toTerm.name })}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {tc("cancel")}
            </Button>
            <ConfirmAction
              trigger={<Button disabled={!from}>{t("copy")}</Button>}
              title={t("copyConfirmTitle", { from: fromName, to: toTerm.name })}
              description={hasAmounts ? t("copyReplaces", { term: toTerm.name }) : t("copyConfirmDescription")}
              confirmLabel={t("copy")}
              destructive={hasAmounts}
              action={() => copySchedule({ fromTermId: from, toTermId: toTerm.id })}
              successMessage={t("copied", { from: fromName })}
              onSuccess={close}
            />
          </div>
        </div>
      )}
    </FormDialog>
  );
}
