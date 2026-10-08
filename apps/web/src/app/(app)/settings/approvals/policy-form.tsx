"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { saveApprovalPolicyAction } from "@/app/(app)/approvals/actions";

interface Step {
  roles: string[];
  userIds: string[];
}
export interface PolicyFormValue {
  enabled: boolean;
  expiryDays: number;
  step1: Step;
  step2: Step | null;
  secondStepFrom: string; // major units as typed
}

function StepPicker({ legend, value, onChange, people }: { legend: string; value: Step; onChange: (s: Step) => void; people: { id: string; name: string; role: string }[] }) {
  const t = useTranslations("approvals.settings");
  const tr = useTranslations("roles");
  const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x));
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{t("anyOf")}</p>
      <div className="flex flex-wrap gap-4">
        {(["SCHOOL_ADMIN", "ACCOUNTANT"] as const).map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.roles.includes(r)} onChange={(e) => onChange({ ...value, roles: toggle(value.roles, r, e.target.checked) })} />
            {t("everyRole", { role: tr(r) })}
          </label>
        ))}
      </div>
      {people.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("orNamed")}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.userIds.includes(p.id)} onChange={(e) => onChange({ ...value, userIds: toggle(value.userIds, p.id, e.target.checked) })} />
                {p.name} <span className="text-xs text-muted-foreground">({tr(p.role as never)})</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/** One process's approval policy (Settings → Approvals). */
export function PolicyForm({ process, initial, people, hasAmount, currencySymbol }: { process: string; initial: PolicyFormValue; people: { id: string; name: string; role: string }[]; hasAmount: boolean; currencySymbol: string }) {
  const t = useTranslations("approvals.settings");
  const router = useRouter();
  const [v, setV] = React.useState<PolicyFormValue>(initial);
  const [pending, start] = React.useTransition();
  const id = React.useId();
  const changed = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveApprovalPolicyAction({ process, policy: v });
          if (r.ok) {
            toast.success(t("saved"));
            router.refresh();
          } else toast.error(Object.values(r.fieldErrors ?? {})[0] ?? r.error);
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
        {t("enabled")}
      </label>
      <StepPicker legend={hasAmount && v.step2 ? t("step1Legend") : t("approversLegend")} value={v.step1} onChange={(s) => setV({ ...v, step1: s })} people={people} />
      {hasAmount ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={v.step2 !== null} onChange={(e) => setV({ ...v, step2: e.target.checked ? { roles: [], userIds: [] } : null })} />
            {t("addSecondStep")}
          </label>
          {v.step2 ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor={`${id}-from`}>{t("secondStepFrom")}</label>
                <span className="text-muted-foreground">{currencySymbol}</span>
                <Input id={`${id}-from`} className="w-40" inputMode="decimal" value={v.secondStepFrom} onChange={(e) => setV({ ...v, secondStepFrom: e.target.value })} placeholder={t("alwaysPlaceholder")} />
              </div>
              <StepPicker legend={t("step2Legend")} value={v.step2} onChange={(s) => setV({ ...v, step2: s })} people={people} />
            </>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`${id}-exp`}>{t("expiry")}</label>
        <Select id={`${id}-exp`} className="w-36" value={String(v.expiryDays)} onChange={(e) => setV({ ...v, expiryDays: Number(e.target.value) })}>
          {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((n) => (
            <option key={n} value={n}>
              {t("days", { count: n })}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={pending || !changed}>
        {t("save")}
      </Button>
    </form>
  );
}
