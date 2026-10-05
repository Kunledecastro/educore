"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { recipientsAction, searchStudentsAction, startThreadAction } from "@/app/(app)/messages/actions";
import { newThreadSchema, type NewThreadInput } from "@/lib/validation/messaging";

type StudentOption = { id: string; name: string; admissionNo: string; className: string };
type RecipientOption = { userId: string; name: string; kind: string; detail: string | null };

export function NewThreadButton({ searchable }: { searchable: boolean }) {
  const t = useTranslations("messages");
  return (
    <FormDialog
      title={t("new")}
      description={t("newDescription")}
      trigger={
        <Button>
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <NewThreadForm searchable={searchable} onDone={close} />}
    </FormDialog>
  );
}

function NewThreadForm({ searchable, onDone }: { searchable: boolean; onDone: () => void }) {
  const t = useTranslations("messages");
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [students, setStudents] = React.useState<StudentOption[]>([]);
  const [recipients, setRecipients] = React.useState<RecipientOption[] | null>(null);
  const { form, onSubmit, pending, fieldError } = useServerForm<NewThreadInput>({
    schema: newThreadSchema,
    defaultValues: { studentId: "", recipientIds: [], subject: "", body: "" },
    submit: async (v) => {
      const result = await startThreadAction(v);
      if (result.ok) router.push(`/messages/${result.data.threadId}`);
      return result;
    },
    successMessage: t("sent"),
    onSuccess: onDone,
  });
  const studentId = form.watch("studentId");

  // Students this person may write about (search for staff; parents see their children).
  React.useEffect(() => {
    const timer = setTimeout(async () => {
      const r = await searchStudentsAction(q);
      if (r.ok) setStudents(r.data);
    }, searchable ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, searchable]);

  // Who they may write to about that student.
  React.useEffect(() => {
    setRecipients(null);
    form.setValue("recipientIds", []);
    if (!studentId) return;
    let live = true;
    recipientsAction(studentId).then((r) => {
      if (!live || !r.ok) return;
      setRecipients(r.data);
      // One obvious recipient (a teacher writing to a single parent): pick them.
      if (r.data.length === 1) form.setValue("recipientIds", [r.data[0]!.userId]);
    });
    return () => {
      live = false;
    };
  }, [studentId, form]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {searchable ? (
        <FormField label={t("findStudent")} htmlFor="nt-q">
          <Input id="nt-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("findStudentHint")} autoComplete="off" />
        </FormField>
      ) : null}
      <FormField label={t("student")} htmlFor="nt-student" error={fieldError("studentId")} required>
        <Select id="nt-student" {...form.register("studentId")}>
          <option value="">{students.length ? t("chooseStudent") : t("noStudents")}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.name} · ${s.className || s.admissionNo}`}
            </option>
          ))}
        </Select>
      </FormField>
      {studentId ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("to")}</legend>
          {recipients === null ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noRecipients")}</p>
          ) : (
            recipients.map((r) => (
              <label key={r.userId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={r.userId} className="h-4 w-4 accent-primary" {...form.register("recipientIds")} />
                <span>
                  {r.name} <span className="text-muted-foreground">({t(`kinds.${r.kind}`)}{r.detail ? ` · ${r.detail}` : ""})</span>
                </span>
              </label>
            ))
          )}
          {fieldError("recipientIds") ? <p className="text-sm text-destructive">{fieldError("recipientIds")}</p> : null}
        </fieldset>
      ) : null}
      <FormField label={t("subject")} htmlFor="nt-subject" error={fieldError("subject")} required>
        <Input id="nt-subject" maxLength={150} {...form.register("subject")} />
      </FormField>
      <FormField label={t("message")} htmlFor="nt-body" error={fieldError("body")} required>
        <Textarea id="nt-body" rows={5} maxLength={5000} {...form.register("body")} />
      </FormField>
      <p className="text-xs text-muted-foreground">{t("safeguarding")}</p>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("send")} />
    </form>
  );
}
