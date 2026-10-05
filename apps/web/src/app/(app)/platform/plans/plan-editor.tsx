"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { MODULES } from "@/lib/entitlements";
import { planEditSchema, type PlanEditInput } from "@/lib/validation/platform";
import { updatePlan } from "../actions";

export function EditPlanButton({ plan }: { plan: PlanEditInput }) {
  const t = useTranslations("platform.plansPage");
  return (
    <FormDialog
      title={t("editTitle", { name: plan.name })}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("editTitle", { name: plan.name })}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t("edit")}
        </Button>
      }
    >
      {(close) => <PlanForm plan={plan} onDone={close} />}
    </FormDialog>
  );
}

function PlanForm({ plan, onDone }: { plan: PlanEditInput; onDone: () => void }) {
  const t = useTranslations("platform.plansPage");
  const tm = useTranslations("plan.modules");
  const { form, onSubmit, pending, fieldError } = useServerForm<PlanEditInput>({
    schema: planEditSchema,
    defaultValues: plan,
    submit: (v) => updatePlan(v),
    successMessage: t("saved"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm">{t("editWarning")}</p>
      <FormField label={t("name")} htmlFor="plan-name" error={fieldError("name")} required>
        <Input id="plan-name" maxLength={40} {...form.register("name")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("price")} htmlFor="plan-price" error={fieldError("price")} hint={t("priceHint")} required>
          <Input id="plan-price" inputMode="decimal" {...form.register("price")} />
        </FormField>
        <FormField label={t("maxStudents")} htmlFor="plan-max" error={fieldError("maxStudents")} hint={t("maxHint")}>
          <Input id="plan-max" inputMode="numeric" {...form.register("maxStudents")} />
        </FormField>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("modules")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULES.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={m} className="h-4 w-4 accent-primary" {...form.register("modules")} />
              {tm(m)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" {...form.register("isPublic")} />
        {t("isPublic")}
      </label>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("save")} />
    </form>
  );
}
