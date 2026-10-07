"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Select } from "@educore/ui/select";
import { saveHealthSettingsAction } from "@/app/(app)/clinic/actions";

export function HealthSettingsForm({ initial, impersonating }: { initial: { adminFullAccess: boolean; retentionYears: number }; impersonating: boolean }) {
  const t = useTranslations("health.settings");
  const router = useRouter();
  const [s, setS] = React.useState(initial);
  const [pending, start] = React.useTransition();
  const changed = s.adminFullAccess !== initial.adminFullAccess || s.retentionYears !== initial.retentionYears;
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveHealthSettingsAction(s);
          if (r.ok) {
            toast.success(t("saved"));
            router.refresh();
          } else toast.error(r.error);
        });
      }}
    >
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={s.adminFullAccess} onChange={(e) => setS({ ...s, adminFullAccess: e.target.checked })} disabled={impersonating} />
          {t("adminFullAccess")}
        </label>
        <p className="pl-6 text-xs text-muted-foreground">{t("adminFullAccessHint")}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="h-retention" className="text-sm font-medium">
          {t("retention")}
        </label>
        <Select id="h-retention" className="w-48" value={String(s.retentionYears)} onChange={(e) => setS({ ...s, retentionYears: Number(e.target.value) })} disabled={impersonating}>
          {Array.from({ length: 11 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? t("retentionNow") : t("retentionYears", { count: n })}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t("retentionHint")}</p>
      </div>
      {impersonating ? <p className="text-sm text-muted-foreground">{t("impersonating")}</p> : null}
      <Button type="submit" size="sm" disabled={pending || !changed || impersonating}>
        {t("save")}
      </Button>
    </form>
  );
}
