"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { remindRegisterAction } from "@/app/(app)/dashboard/actions";

/** "Remind" on a register that isn't taken (once per class per day). */
export function RemindButton({ sectionId, className, reminded }: { sectionId: string; className: string; reminded: boolean }) {
  const t = useTranslations("dashboard.remind");
  const router = useRouter();
  const [busy, start] = React.useTransition();
  if (reminded) return <span className="text-xs font-semibold text-muted-foreground">{t("sent")}</span>;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      aria-label={t("buttonFor", { name: className })}
      onClick={() =>
        start(async () => {
          const r = await remindRegisterAction(sectionId);
          if (r.ok) {
            toast.success(t("done", { name: className }));
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {t("button")}
    </Button>
  );
}
