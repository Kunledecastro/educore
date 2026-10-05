"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { saveLoginSettingsAction } from "@/app/(app)/students/logins/actions";

/** Admins: switch student logins on and choose which classes (Phase 5.0). */
export function LoginSettingsForm({ classes, initial }: { classes: { id: string; name: string }[]; initial: { enabled: boolean; classIds: string[] } }) {
  const t = useTranslations("studentLogins.settings");
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [chosen, setChosen] = React.useState(new Set(initial.classIds));
  const [pending, start] = React.useTransition();
  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = () =>
    start(async () => {
      const r = await saveLoginSettingsAction({ enabled, classIds: [...chosen] });
      if (r.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <span className="font-medium">{t("enable")}</span>
          <span className="block text-muted-foreground">{t("enableHint")}</span>
        </span>
      </label>
      <fieldset disabled={!enabled} className="space-y-2 disabled:opacity-50">
        <legend className="text-sm font-medium">{t("classes")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {classes.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="button" onClick={save} disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </div>
  );
}
