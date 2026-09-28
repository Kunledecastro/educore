"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { GENDERS, studentSchema, type StudentInput } from "@/lib/validation/people";
import { createStudent, updateStudent } from "./actions";

export interface ClassOption {
  id: string;
  name: string;
  sections: { id: string; name: string }[];
}

export interface StudentFormData {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  classId: string;
  sectionId: string;
  admissionDate: string;
}

export function StudentForm({ classes, student, onDone }: { classes: ClassOption[]; student?: StudentFormData; onDone: () => void }) {
  const t = useTranslations("students");
  const { form, onSubmit, pending, fieldError } = useServerForm<StudentInput>({
    schema: studentSchema,
    defaultValues: {
      admissionNo: student?.admissionNo ?? "",
      firstName: student?.firstName ?? "",
      lastName: student?.lastName ?? "",
      dateOfBirth: student?.dateOfBirth ?? "",
      gender: (student?.gender as StudentInput["gender"]) ?? "",
      classId: student?.classId ?? "",
      sectionId: student?.sectionId ?? "",
      admissionDate: student?.admissionDate ?? "",
    },
    submit: (v) => (student ? updateStudent(student.id, v) : createStudent(v)),
    successMessage: student ? t("updated") : t("created"),
    onSuccess: onDone,
  });

  const classId = form.watch("classId");
  const sections = classes.find((c) => c.id === classId)?.sections ?? [];
  // Clear a section that doesn't belong to a newly chosen class.
  React.useEffect(() => {
    const current = form.getValues("sectionId");
    if (current && !sections.some((s) => s.id === current)) form.setValue("sectionId", "");
  }, [classId, sections, form]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("firstName")} htmlFor="st-first" error={fieldError("firstName")} required>
          <Input autoComplete="off" autoFocus {...form.register("firstName")} />
        </FormField>
        <FormField label={t("lastName")} htmlFor="st-last" error={fieldError("lastName")} required>
          <Input autoComplete="off" {...form.register("lastName")} />
        </FormField>
        <FormField label={t("admissionNo")} htmlFor="st-adm" error={fieldError("admissionNo")} required>
          <Input className="uppercase" autoComplete="off" {...form.register("admissionNo")} />
        </FormField>
        <FormField label={t("gender")} htmlFor="st-gender" error={fieldError("gender")}>
          <Select {...form.register("gender")}>
            <option value="">{t("notSpecified")}</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {t(`genders.${g}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("class")} htmlFor="st-class" error={fieldError("classId")} required>
          <Select {...form.register("classId")}>
            <option value="">{t("chooseClass")}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("section")} htmlFor="st-section" error={fieldError("sectionId")}>
          <Select {...form.register("sectionId")} disabled={sections.length === 0}>
            <option value="">{t("chooseSection")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("dateOfBirth")} htmlFor="st-dob" error={fieldError("dateOfBirth")}>
          <Input type="date" {...form.register("dateOfBirth")} />
        </FormField>
        <FormField label={t("admissionDate")} htmlFor="st-admdate" hint={student ? undefined : t("admissionDateHint")} error={fieldError("admissionDate")}>
          <Input type="date" {...form.register("admissionDate")} />
        </FormField>
      </div>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
