import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Circle, CircleDot, Lock, PartyPopper } from "lucide-react";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { cn } from "@educore/ui/utils";
import type { OnboardingChecklist as Checklist, OnboardingStep } from "@/lib/onboarding";
import { OnboardingVisibilityButton } from "./onboarding-visibility-button";

/** Setup checklist on the school admin's dashboard (milestone 1.4). Server-rendered; progress comes from real data. */
export async function OnboardingChecklist({ checklist }: { checklist: Checklist }) {
  const t = await getTranslations("onboarding");
  const pct = Math.round((checklist.doneCount / checklist.total) * 100);

  return (
    <Card aria-labelledby="onboarding-title">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle id="onboarding-title" className="text-lg">
            {checklist.complete ? t("completeTitle") : t("title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {checklist.complete ? t("completeDescription") : t("description")}
          </p>
        </div>
        <OnboardingVisibilityButton hide />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("progress", { done: checklist.doneCount, total: checklist.total })}</p>
          <div
            role="progressbar"
            aria-label={t("progressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full transition-all duration-500", checklist.complete ? "bg-success" : "bg-primary")}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
        </div>

        {checklist.complete ? (
          <div className="flex items-center gap-3 rounded-md border border-success/40 bg-success/10 p-4 text-sm">
            <PartyPopper className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <p>{t("completeNext")}</p>
          </div>
        ) : null}

        <ol className="divide-y rounded-md border">
          {checklist.steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i + 1} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

async function StepRow({ step, index }: { step: OnboardingStep; index: number }) {
  const t = await getTranslations("onboarding");
  const Icon = step.status === "done" ? CheckCircle2 : step.status === "blocked" ? Lock : step.current ? CircleDot : Circle;

  return (
    <li
      className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between", step.current && "bg-primary/5")}
      aria-current={step.current ? "step" : undefined}
    >
      <div className="flex gap-3">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            step.status === "done" && "text-success",
            step.status === "blocked" && "text-muted-foreground",
            step.current && "text-primary",
          )}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className={cn("font-medium", step.status === "blocked" && "text-muted-foreground")}>
            <span className="sr-only">{t(`status.${step.status}`)}: </span>
            {index}. {t(`steps.${step.id}.title`)}
          </p>
          <p className="text-sm text-muted-foreground">
            {step.status === "done"
              ? t(`steps.${step.id}.done`, step.progress)
              : step.status === "blocked"
                ? t("waitingFor", { steps: step.waitingFor.map((w) => t(`steps.${w}.title`)).join(", ") })
                : t(`steps.${step.id}.todo`, step.progress)}
          </p>
        </div>
      </div>
      {step.status === "todo" ? (
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          <Link href={step.href} className={buttonVariants({ size: "sm", variant: step.current ? "default" : "outline" })}>
            {t(`steps.${step.id}.action`)}
          </Link>
          {step.secondaryHref ? (
            <Link href={step.secondaryHref} className={buttonVariants({ size: "sm", variant: "ghost" })}>
              {t(`steps.${step.id}.secondaryAction`)}
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Slim reminder shown instead of the full checklist after an admin hides it before finishing. */
export async function OnboardingReminder({ checklist }: { checklist: Checklist }) {
  const t = await getTranslations("onboarding");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3 text-sm">
      <p>
        {t("reminder", { done: checklist.doneCount, total: checklist.total })}
        {checklist.next ? <> {t("reminderNext", { step: t(`steps.${checklist.next.id}.title`) })}</> : null}
      </p>
      <OnboardingVisibilityButton hide={false} />
    </div>
  );
}
