"use client";

import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { FormDialogFooter } from "@/components/form/form-dialog";
import { useServerForm } from "@/components/form/use-server-form";
import { academicYearSchema, type AcademicYearInput } from "@/lib/validation/academics";
import { createAcademicYear, updateAcademicYear } from "./actions";

export function YearForm({
  year,
  onDone,
}: {
  year?: { id: string; name: string; startDate: string; endDate: string };
  onDone: () => void;
}) {
  const t = useTranslations("academics.years");
  const { form, onSubmit, pending, fieldError } = useServerForm<AcademicYearInput>({
    schema: academicYearSchema,
    defaultValues: { name: year?.name ?? "", startDate: year?.startDate ?? "", endDate: year?.endDate ?? "" },
    submit: (values) => (year ? updateAcademicYear(year.id, values) : createAcademicYear(values)),
    successMessage: year ? t("updated") : t("created"),
    onSuccess: onDone,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("name")} htmlFor="year-name" hint={t("nameHint")} error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus {...form.register("name")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("startDate")} htmlFor="year-start" error={fieldError("startDate")} required>
          <Input type="date" {...form.register("startDate")} />
        </FormField>
        <FormField label={t("endDate")} htmlFor="year-end" error={fieldError("endDate")} required>
          <Input type="date" {...form.register("endDate")} />
        </FormField>
      </div>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
