"use client";

import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { academicOptionsSchema, type AcademicOptionsInput } from "@/lib/validation/settings";
import { saveAcademicOptions } from "../actions";

export function OptionsForm({ initial }: { initial: { showPosition: boolean; attendanceEditDays: string } }) {
  const t = useTranslations("settings.options");
  const tc = useTranslations("common");
  const { form, onSubmit, pending, fieldError } = useServerForm<AcademicOptionsInput>({
    schema: academicOptionsSchema,
    defaultValues: initial,
    submit: (values) => saveAcademicOptions(values),
    successMessage: t("saved"),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <fieldset className="space-y-2 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("resultsLegend")}</legend>
        <label className="flex items-start gap-3 text-sm" htmlFor="opt-position">
          <input
            id="opt-position"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            aria-describedby="opt-position-hint"
            {...form.register("showPosition")}
          />
          <span>
            <span className="font-medium">{t("showPosition")}</span>
            <span id="opt-position-hint" className="block text-muted-foreground">
              {t("showPositionHint")}
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("attendanceLegend")}</legend>
        <FormField label={t("editDays")} htmlFor="opt-edit-days" hint={t("editDaysHint")} error={fieldError("attendanceEditDays")}>
          <Input type="number" inputMode="numeric" min={0} max={60} className="w-28" {...form.register("attendanceEditDays")} />
        </FormField>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
      </div>
    </form>
  );
}
