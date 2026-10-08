"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { decideAction, withdrawAction } from "../actions";

/** Approve (optional comment) or reject (a reason is required). */
export function DecisionPanel({ requestId, step, isFinal }: { requestId: string; step: number; isFinal: boolean }) {
  const t = useTranslations("approvals.detail");
  const router = useRouter();
  const [comment, setComment] = React.useState("");
  const [pending, start] = React.useTransition();
  const id = React.useId();
  const send = (decision: "APPROVE" | "REJECT") =>
    start(async () => {
      if (decision === "REJECT" && !comment.trim()) {
        toast.error(t("reasonNeeded"));
        return;
      }
      const r = await decideAction(requestId, { decision, comment, expectedStep: step });
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
        return;
      }
      const outcome = r.data.outcome;
      if (outcome === "failed") toast.error(t("failedNow"));
      else toast.success(t(`done.${outcome}`));
      router.refresh();
    });
  return (
    <section className="space-y-3 rounded-lg border border-primary/40 bg-card p-5" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="font-semibold">
        {t("yourDecision")}
      </h2>
      <p className="text-sm text-muted-foreground">{isFinal ? t("finalHint") : t("stepHint")}</p>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-c`} className="text-sm font-medium">
          {t("comment")}
        </label>
        <Textarea id={`${id}-c`} rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("commentPlaceholder")} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => send("APPROVE")}>
          {isFinal ? t("approveApply") : t("approveStep")}
        </Button>
        <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => send("REJECT")}>
          {t("reject")}
        </Button>
      </div>
    </section>
  );
}

export function WithdrawButton({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals.detail");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button type="button" variant="outline" size="sm">
          {t("withdraw")}
        </Button>
      }
      title={t("withdrawTitle")}
      description={t("withdrawDescription")}
      confirmLabel={t("withdraw")}
      action={() => withdrawAction(requestId)}
      successMessage={t("withdrawn")}
      onSuccess={() => router.refresh()}
    />
  );
}
