"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { setOnboardingHidden } from "@/app/(app)/dashboard/actions";

/** Hide / show the setup checklist. Not destructive (it comes back with one click), so no confirmation dialog. */
export function OnboardingVisibilityButton({ hide }: { hide: boolean }) {
  const t = useTranslations("onboarding");
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      variant={hide ? "ghost" : "outline"}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setOnboardingHidden(hide);
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? t("working") : hide ? t("hide") : t("show")}
    </Button>
  );
}
