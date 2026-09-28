"use client";

import * as React from "react";
import { Plus, UserCog, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Button } from "@educore/ui/button";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { assignmentSchema, type AssignmentInput } from "@/lib/validation/academics";
import { idSchema } from "@/lib/validation/common";
import { createAssignment, deleteAssignment, reassignTeacher } from "../actions";

export interface Option {
  id: string;
  label: string;
}
export interface SectionGroup {
  className: string;
  sections: Option[];
}

function TeacherOptions({ teachers }: { teachers: Option[] }) {
  return (
    <>
      {teachers.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );
}

function AssignmentForm({
  sectionGroups,
  subjects,
  teachers,
  onDone,
}: {
  sectionGroups: SectionGroup[];
  subjects: Option[];
  teachers: Option[];
  onDone: () => void;
}) {
  const t = useTranslations("academics.assignments");
  const { form, onSubmit, pending, fieldError } = useServerForm<AssignmentInput>({
    schema: assignmentSchema,
    defaultValues: { sectionId: "", subjectId: "", teacherId: "" },
    submit: createAssignment,
    successMessage: t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("section")} htmlFor="asg-section" error={fieldError("sectionId")} required>
        <Select {...form.register("sectionId")}>
          <option value="">{t("chooseSection")}</option>
          {sectionGroups.map((g) => (
            <optgroup key={g.className} label={g.className}>
              {g.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </FormField>
      <FormField label={t("subject")} htmlFor="asg-subject" error={fieldError("subjectId")} required>
        <Select {...form.register("subjectId")}>
          <option value="">{t("chooseSubject")}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("teacher")} htmlFor="asg-teacher" error={fieldError("teacherId")} required>
        <Select {...form.register("teacherId")}>
          <option value="">{t("chooseTeacher")}</option>
          <TeacherOptions teachers={teachers} />
        </Select>
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function NewAssignmentButton(props: { sectionGroups: SectionGroup[]; subjects: Option[]; teachers: Option[] }) {
  const t = useTranslations("academics.assignments");
  return (
    <FormDialog
      title={t("new")}
      trigger={
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <AssignmentForm {...props} onDone={close} />}
    </FormDialog>
  );
}

const reassignSchema = z.object({ teacherId: idSchema });

function ReassignForm({ id, currentTeacherId, teachers, onDone }: { id: string; currentTeacherId: string; teachers: Option[]; onDone: () => void }) {
  const t = useTranslations("academics.assignments");
  const { form, onSubmit, pending, fieldError } = useServerForm<{ teacherId: string }>({
    schema: reassignSchema,
    defaultValues: { teacherId: currentTeacherId },
    submit: (values) => reassignTeacher(id, values.teacherId),
    successMessage: t("updated"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("teacher")} htmlFor="reassign-teacher" error={fieldError("teacherId")} required>
        <Select {...form.register("teacherId")}>
          <TeacherOptions teachers={teachers} />
        </Select>
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function AssignmentRowActions({
  assignment,
  teachers,
}: {
  assignment: { id: string; teacherId: string; teacherName: string; subjectName: string; sectionLabel: string };
  teachers: Option[];
}) {
  const t = useTranslations("academics.assignments");
  const [removing, setRemoving] = React.useState(false);
  const context = `${assignment.subjectName} · ${assignment.sectionLabel}`;
  return (
    <div className="flex justify-end gap-1">
      <FormDialog
        title={t("reassign")}
        description={context}
        trigger={
          <Button variant="ghost" size="sm" aria-label={`${t("reassign")}: ${context}`}>
            <UserCog className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">{t("reassign")}</span>
          </Button>
        }
      >
        {(close) => <ReassignForm id={assignment.id} currentTeacherId={assignment.teacherId} teachers={teachers} onDone={close} />}
      </FormDialog>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setRemoving(true)}
        aria-label={`${t("remove")}: ${context}`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="hidden lg:inline">{t("remove")}</span>
      </Button>
      <ConfirmAction
        open={removing}
        onOpenChange={setRemoving}
        title={t("deleteTitle")}
        description={t("deleteDescription", {
          teacher: assignment.teacherName,
          subject: assignment.subjectName,
          section: assignment.sectionLabel,
        })}
        confirmLabel={t("remove")}
        action={() => deleteAssignment(assignment.id)}
        successMessage={t("deleted")}
      />
    </div>
  );
}
