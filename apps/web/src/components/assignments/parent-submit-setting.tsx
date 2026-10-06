"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { saveAssignmentSettingsAction } from "@/app/(app)/assignments/actions";
import type { ParentSubmitMode } from "@/lib/assignments/rules";

const MODES: ParentSubmitMode[] = ["auto", "always", "never"];

/** School admins: may parents hand work in for their children? (Phase 5.2) */
export function ParentSubmitSetting({ initial }: { initial: ParentSubmitMode }) {
  const t = useTranslations("assignments.settings");
  const router = useRouter();
  const [mode, setMode] = React.useState(initial);
  const [pending, start] = React.useTransition();
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("title", { current: t(`modes.${initial}`) })}</summary>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm text-muted-foreground">{t("question")}</legend>
        {MODES.map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input type="radio" name="parentSubmit" className="mt-0.5 h-4 w-4 accent-primary" checked={mode === m} onChange={() => setMode(m)} />
            <span>
              <span className="font-medium">{t(`modes.${m}`)}</span>
              <span className="block text-muted-foreground">{t(`hints.${m}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button
        type="button"
        size="sm"
        className="mt-3"
        disabled={pending || mode === initial}
        onClick={() =>
          start(async () => {
            const r = await saveAssignmentSettingsAction({ parentSubmit: mode });
            if (r.ok) {
              toast.success(t("saved"));
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        {t("save")}
      </Button>
    </details>
  );
}
