"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Layers, LogIn, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { impersonateSchema, PLAN_CODES, suspendSchema, tenantPlanSchema, type ImpersonateInput, type SuspendInput, type TenantPlanInput } from "@/lib/validation/platform";
import { changeTenantPlan, reactivateTenant, startImpersonationAction, suspendTenant } from "../../actions";

export function SuspendButton({ tenantId, name }: { tenantId: string; name: string }) {
  const t = useTranslations("platform.tenant");
  return (
    <FormDialog
      title={t("suspendTitle", { name })}
      trigger={
        <Button variant="outline" className="text-destructive">
          <Ban className="h-4 w-4" aria-hidden="true" />
          {t("suspend")}
        </Button>
      }
    >
      {(close) => <SuspendForm tenantId={tenantId} onDone={close} />}
    </FormDialog>
  );
}

function SuspendForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const t = useTranslations("platform.tenant");
  const { form, onSubmit, pending, fieldError } = useServerForm<SuspendInput>({
    schema: suspendSchema,
    defaultValues: { tenantId, reason: "" },
    submit: (v) => suspendTenant(v),
    successMessage: t("suspended"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{t("suspendIntro")}</p>
      <FormField label={t("reason")} htmlFor="suspend-reason" error={fieldError("reason")} required>
        <Input maxLength={300} autoFocus {...form.register("reason")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("suspend")} />
    </form>
  );
}

export function ReactivateButton({ tenantId, name }: { tenantId: string; name: string }) {
  const t = useTranslations("platform.tenant");
  return (
    <ConfirmAction
      trigger={
        <Button>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t("reactivate")}
        </Button>
      }
      title={t("reactivateTitle", { name })}
      description={t("reactivateDescription")}
      confirmLabel={t("reactivate")}
      destructive={false}
      action={() => reactivateTenant(tenantId)}
      successMessage={t("reactivated")}
    />
  );
}

export function ImpersonateButton({ userId, name, school }: { userId: string; name: string; school: string }) {
  const t = useTranslations("platform.tenant");
  return (
    <FormDialog
      title={t("impersonateTitle", { name, school })}
      trigger={
        <Button variant="outline" size="sm">
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {t("impersonate")}
        </Button>
      }
    >
      {(close) => <ImpersonateForm userId={userId} onDone={close} />}
    </FormDialog>
  );
}

function ImpersonateForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const t = useTranslations("platform.tenant");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<ImpersonateInput>({
    schema: impersonateSchema,
    defaultValues: { userId, reason: "" },
    submit: (v) => startImpersonationAction(v),
    successMessage: t("impersonating"),
    onSuccess: () => {
      onDone();
      router.push("/dashboard");
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("impersonateIntro")}</p>
      <FormField label={t("impersonateReason")} htmlFor="imp-reason" error={fieldError("reason")} hint={t("impersonateReasonHint")} required>
        <Input maxLength={300} autoFocus {...form.register("reason")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("impersonate")} />
    </form>
  );
}

export function ChangePlanButton({ tenantId, plan, until }: { tenantId: string; plan: TenantPlanInput["plan"]; until: string }) {
  const t = useTranslations("platform.tenant");
  return (
    <FormDialog
      title={t("changePlanTitle")}
      trigger={
        <Button variant="outline" size="sm">
          <Layers className="h-4 w-4" aria-hidden="true" />
          {t("changePlan")}
        </Button>
      }
    >
      {(close) => <ChangePlanForm tenantId={tenantId} plan={plan} until={until} onDone={close} />}
    </FormDialog>
  );
}

function ChangePlanForm({ tenantId, plan, until, onDone }: { tenantId: string; plan: TenantPlanInput["plan"]; until: string; onDone: () => void }) {
  const t = useTranslations("platform.tenant");
  const tp = useTranslations("platform.plans");
  const { form, onSubmit, pending, fieldError } = useServerForm<TenantPlanInput>({
    schema: tenantPlanSchema,
    defaultValues: { tenantId, plan, until, note: "" },
    submit: (v) => changeTenantPlan(v),
    successMessage: t("planChanged"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("changePlanIntro")}</p>
      <FormField label={t("plan")} htmlFor="plan-code" error={fieldError("plan")} required>
        <Select id="plan-code" {...form.register("plan")}>
          {PLAN_CODES.map((c) => (
            <option key={c} value={c}>
              {tp(c)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("until")} htmlFor="plan-until" error={fieldError("until")} hint={t("untilHint")}>
        <Input id="plan-until" type="date" {...form.register("until")} />
      </FormField>
      <FormField label={t("note")} htmlFor="plan-note" error={fieldError("note")} hint={t("noteHint")} required>
        <Input id="plan-note" maxLength={300} {...form.register("note")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("changePlan")} />
    </form>
  );
}
