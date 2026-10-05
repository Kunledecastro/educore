"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { stopImpersonationAction } from "@/app/(app)/platform/actions";

export function StopImpersonationButton() {
  const t = useTranslations("platform.impersonation");
  const [pending, startTransition] = React.useTransition();
  return (
    <Button size="sm" variant="outline" className="h-8 bg-background text-foreground" disabled={pending} onClick={() => startTransition(() => stopImpersonationAction())}>
      {pending ? t("stopping") : t("stop")}
    </Button>
  );
}
