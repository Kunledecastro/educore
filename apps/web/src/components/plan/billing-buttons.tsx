"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { choosePlanAction, setAutoRenewAction } from "@/app/(app)/plan/actions";
import type { PlanAction } from "@/lib/billing/rules";

/**
 * "Choose this plan" on Plan & billing (4.2). The server decides what it
 * means (pay on Paystack, upgrade now, downgrade at renewal); the button only
 * says it in words, with the amount, and asks to confirm.
 */
export function ChoosePlanButton({
  plan,
  planName,
  action,
  description,
  variant = "default",
}: {
  plan: "STARTER" | "STANDARD" | "PREMIUM";
  planName: string;
  action: Exclude<PlanAction, "none">;
  description: string;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("plan.choose");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button variant={variant} className="w-full">
          {action === "checkout" ? <CreditCard className="h-4 w-4" aria-hidden="true" /> : null}
          {t(`button.${action}`, { plan: planName })}
        </Button>
      }
      title={t(`title.${action}`, { plan: planName })}
      description={description}
      confirmLabel={t(`confirm.${action}`)}
      destructive={false}
      action={async () => {
        const result = await choosePlanAction({ plan });
        if (result.ok && result.data.url) window.location.assign(result.data.url);
        return result;
      }}
      successMessage={action === "checkout" ? t("redirecting") : t("done")}
      onSuccess={() => router.refresh()}
    />
  );
}

export function AutoRenewButton({ on, paidUntil }: { on: boolean; paidUntil: string }) {
  const t = useTranslations("plan.billing");
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline" size="sm" className={on ? "text-destructive" : undefined}>
          {on ? t("turnOff") : t("turnOn")}
        </Button>
      }
      title={on ? t("turnOffTitle") : t("turnOnTitle")}
      description={on ? t("turnOffDescription", { date: paidUntil }) : t("turnOnDescription")}
      confirmLabel={on ? t("turnOff") : t("turnOn")}
      destructive={on}
      action={() => setAutoRenewAction(!on)}
      successMessage={on ? t("turnedOff") : t("turnedOn")}
    />
  );
}
