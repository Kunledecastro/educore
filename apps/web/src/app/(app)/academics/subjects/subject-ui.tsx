"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { Input } from "@educore/ui/input";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { subjectSchema, type SubjectInput } from "@/lib/validation/academics";
import { createSubject, deleteSubject, updateSubject } from "../actions";

function SubjectForm({ subject, onDone }: { subject?: { id: string; name: string; code: string }; onDone: () => void }) {
  const t = useTranslations("academics.subjects");
  const { form, onSubmit, pending, fieldError } = useServerForm<SubjectInput>({
    schema: subjectSchema,
    defaultValues: { name: subject?.name ?? "", code: subject?.code ?? "" },
    submit: (values) => (subject ? updateSubject(subject.id, values) : createSubject(values)),
    successMessage: subject ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("name")} htmlFor="subject-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={t("code")} htmlFor="subject-code" hint={t("codeHint")} error={fieldError("code")} required>
        <Input placeholder={t("codePlaceholder")} className="uppercase" autoCapitalize="characters" {...form.register("code")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function NewSubjectButton() {
  const t = useTranslations("academics.subjects");
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
      {(close) => <SubjectForm onDone={close} />}
    </FormDialog>
  );
}

export function SubjectRowActions({ subject }: { subject: { id: string; name: string; code: string } }) {
  const t = useTranslations("academics.subjects");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${subject.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {tc("edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <SubjectForm subject={subject} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: subject.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteSubject(subject.id)}
        successMessage={t("deleted")}
      />
    </div>
  );
}
