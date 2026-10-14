"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { saveLeaveTypeAction } from "@/app/(app)/leave/actions";

interface Value {
  id: string | null;
  name: string;
  daysPerYear: number;
  isActive: boolean;
}

function TypeForm({ initial, submitLabel, resetAfter }: { initial: Value; submitLabel: string; resetAfter?: boolean }) {
  const t = useTranslations("leave.settings");
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, start] = React.useTransition();
  const id = React.useId();
  const changed = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveLeaveTypeAction(v);
          if (r.ok) {
            toast.success(t("saved"));
            setErrors({});
            if (resetAfter) setV(initial);
            router.refresh();
          } else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <div className="min-w-48 flex-1 space-y-1">
        <label htmlFor={`${id}-name`} className="text-xs font-medium">
          {t("name")}
        </label>
        <Input id={`${id}-name`} value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={Boolean(errors.name)} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
      </div>
      <div className="w-32 space-y-1">
        <label htmlFor={`${id}-days`} className="text-xs font-medium">
          {t("daysPerYear")}
        </label>
        <Input id={`${id}-days`} type="number" min={0} max={366} value={v.daysPerYear} onChange={(e) => setV({ ...v, daysPerYear: Number(e.target.value) })} aria-invalid={Boolean(errors.daysPerYear)} />
        {errors.daysPerYear ? <p className="text-xs text-destructive">{errors.daysPerYear}</p> : null}
      </div>
      <label className="flex h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        {t("active")}
      </label>
      <Button type="submit" size="sm" disabled={busy || !changed}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function LeaveTypeRow({ value }: { value: Value }) {
  const t = useTranslations("leave.settings");
  return <TypeForm initial={value} submitLabel={t("save")} />;
}

export function NewLeaveType() {
  const t = useTranslations("leave.settings");
  return <TypeForm initial={{ id: null, name: "", daysPerYear: 5, isActive: true }} submitLabel={t("add")} resetAfter />;
}
