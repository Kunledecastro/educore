"use client";

import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { FormDialogFooter } from "@/components/form/form-dialog";
import { useServerForm } from "@/components/form/use-server-form";
import { classSchema, sectionSchema, type ClassInput, type SectionInput } from "@/lib/validation/academics";
import { createClass, createSection, updateClass, updateSection } from "../actions";

export function ClassForm({
  academicYearId,
  cls,
  onDone,
}: {
  academicYearId: string;
  cls?: { id: string; name: string; order: number };
  onDone: () => void;
}) {
  const t = useTranslations("academics.classes");
  const { form, onSubmit, pending, fieldError } = useServerForm<ClassInput>({
    schema: classSchema,
    defaultValues: { academicYearId, name: cls?.name ?? "", order: cls ? String(cls.order) : "" },
    submit: (values) => (cls ? updateClass(cls.id, values) : createClass(values)),
    successMessage: cls ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("academicYearId")} />
      <FormField label={t("name")} htmlFor="class-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={t("order")} htmlFor="class-order" hint={t("orderHint")} error={fieldError("order")}>
        <Input type="number" inputMode="numeric" min={0} max={99} {...form.register("order")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function SectionForm({
  classId,
  section,
  onDone,
}: {
  classId: string;
  section?: { id: string; name: string; capacity: number | null };
  onDone: () => void;
}) {
  const t = useTranslations("academics.sections");
  const { form, onSubmit, pending, fieldError } = useServerForm<SectionInput>({
    schema: sectionSchema,
    defaultValues: { classId, name: section?.name ?? "", capacity: section?.capacity != null ? String(section.capacity) : "" },
    submit: (values) => (section ? updateSection(section.id, values) : createSection(values)),
    successMessage: section ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("classId")} />
      <FormField label={t("name")} htmlFor="section-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={t("capacity")} htmlFor="section-capacity" hint={t("capacityHint")} error={fieldError("capacity")}>
        <Input type="number" inputMode="numeric" min={1} max={500} {...form.register("capacity")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
