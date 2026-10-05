"use client";

import { useRouter } from "next/navigation";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { createAssignmentAction, deleteAssignmentAction, setAssignmentStatusAction, updateAssignmentAction } from "@/app/(app)/assignments/actions";
import { assignmentCreateSchema, assignmentEditSchema, type AssignmentCreateInput, type AssignmentEditInput } from "@/lib/validation/assignments";

/** Subjects this person may set work in, each with the sections (class + arm) they may set it for. */
export interface AssignmentOptions {
  subjects: { id: string; name: string; sections: { id: string; name: string }[] }[];
  /** A sensible default due time ("YYYY-MM-DDTHH:mm", school time). */
  defaultDue: string;
}

export function NewAssignmentButton({ options }: { options: AssignmentOptions }) {
  const t = useTranslations("assignments");
  return (
    <FormDialog
      title={t("new")}
      trigger={
        <Button>
          <NotebookPen className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <CreateForm options={options} onDone={close} />}
    </FormDialog>
  );
}

function CommonFields({ form, fieldError, prefix }: { form: ReturnType<typeof useServerForm<AssignmentEditInput>>["form"]; fieldError: (n: keyof AssignmentEditInput) => string | undefined; prefix: string }) {
  const t = useTranslations("assignments");
  return (
    <>
      <FormField label={t("title")} htmlFor={`${prefix}-title`} error={fieldError("title")} required>
        <Input maxLength={150} {...form.register("title")} />
      </FormField>
      <FormField label={t("instructions")} htmlFor={`${prefix}-instructions`} error={fieldError("instructions")} hint={t("instructionsHint")}>
        <Textarea rows={6} maxLength={10000} {...form.register("instructions")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("dueAt")} htmlFor={`${prefix}-due`} error={fieldError("dueAt")} hint={t("dueHint")} required>
          <Input type="datetime-local" {...form.register("dueAt")} />
        </FormField>
        <FormField label={t("maxScore")} htmlFor={`${prefix}-max`} error={fieldError("maxScore")} hint={t("maxScoreHint")}>
          <Input type="number" inputMode="decimal" min={0.5} max={1000} step={0.5} {...form.register("maxScore")} />
        </FormField>
      </div>
      <FormField label={t("mode")} htmlFor={`${prefix}-mode`} error={fieldError("mode")} hint={t("modeHint")} required>
        <Select {...form.register("mode")}>
          <option value="ONLINE">{t("modes.ONLINE")}</option>
          <option value="PAPER">{t("modes.PAPER")}</option>
        </Select>
      </FormField>
    </>
  );
}

function CreateForm({ options, onDone }: { options: AssignmentOptions; onDone: () => void }) {
  const t = useTranslations("assignments");
  const router = useRouter();
  const first = options.subjects[0];
  const { form, onSubmit, pending, fieldError } = useServerForm<AssignmentCreateInput>({
    schema: assignmentCreateSchema,
    defaultValues: {
      title: "",
      instructions: "",
      dueAt: options.defaultDue,
      maxScore: "" as unknown as null,
      mode: "ONLINE",
      subjectId: first?.id ?? "",
      sectionIds: first && first.sections.length === 1 ? [first.sections[0]!.id] : [],
      publish: true,
    },
    submit: createAssignmentAction,
    successMessage: t("created"),
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  const subjectId = form.watch("subjectId");
  const chosen = new Set(form.watch("sectionIds"));
  const sections = options.subjects.find((s) => s.id === subjectId)?.sections ?? [];
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    form.setValue("sectionIds", [...next], { shouldValidate: true });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("subject")} htmlFor="as-subject" error={fieldError("subjectId")} required>
        <Select
          {...form.register("subjectId", {
            onChange: () => form.setValue("sectionIds", []),
          })}
        >
          {options.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </FormField>
      <fieldset className="space-y-2" aria-describedby={fieldError("sectionIds") ? "as-sections-error" : undefined}>
        <legend className="text-sm font-medium">
          {t("sections")} <span className="text-destructive">*</span>
        </legend>
        <p className="text-xs text-muted-foreground">{t("sectionsHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
        {fieldError("sectionIds") ? (
          <p id="as-sections-error" className="text-sm text-destructive">
            {fieldError("sectionIds")}
          </p>
        ) : null}
      </fieldset>
      <CommonFields form={form as never} fieldError={fieldError as never} prefix="as" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" {...form.register("publish")} />
        <span>
          <span className="font-medium">{t("publishNow")}</span>
          <span className="block text-muted-foreground">{t("publishNowHint")}</span>
        </span>
      </label>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("create")} />
    </form>
  );
}

export function EditAssignmentButton({ id, initial }: { id: string; initial: AssignmentEditInput }) {
  const t = useTranslations("assignments");
  return (
    <FormDialog
      title={t("edit")}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t("edit")}
        </Button>
      }
    >
      {(close) => <EditForm id={id} initial={initial} onDone={close} />}
    </FormDialog>
  );
}

function EditForm({ id, initial, onDone }: { id: string; initial: AssignmentEditInput; onDone: () => void }) {
  const t = useTranslations("assignments");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<AssignmentEditInput>({
    schema: assignmentEditSchema,
    defaultValues: initial,
    submit: (v) => updateAssignmentAction(id, v),
    successMessage: t("saved"),
    onSuccess: () => {
      onDone();
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <CommonFields form={form} fieldError={fieldError} prefix="ae" />
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("save")} />
    </form>
  );
}

/** Publish / close / reopen / delete, with a confirmation each. */
export function AssignmentStatusControls({ id, title, status, canDelete }: { id: string; title: string; status: "DRAFT" | "PUBLISHED" | "CLOSED"; canDelete: boolean }) {
  const t = useTranslations("assignments");
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <>
      {status !== "PUBLISHED" ? (
        <ConfirmAction
          trigger={<Button size="sm">{status === "DRAFT" ? t("publish") : t("reopen")}</Button>}
          title={status === "DRAFT" ? t("publishTitle", { title }) : t("reopenTitle", { title })}
          description={status === "DRAFT" ? t("publishDescription") : t("reopenDescription")}
          confirmLabel={status === "DRAFT" ? t("publish") : t("reopen")}
          destructive={false}
          action={() => setAssignmentStatusAction(id, "PUBLISHED")}
          successMessage={t("updated")}
          onSuccess={refresh}
        />
      ) : (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="outline">
              {t("close")}
            </Button>
          }
          title={t("closeTitle", { title })}
          description={t("closeDescription")}
          confirmLabel={t("close")}
          destructive={false}
          action={() => setAssignmentStatusAction(id, "CLOSED")}
          successMessage={t("updated")}
          onSuccess={refresh}
        />
      )}
      {canDelete ? (
        <ConfirmAction
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("delete")}
            </Button>
          }
          title={t("deleteTitle")}
          description={t("deleteDescription", { title })}
          confirmLabel={t("delete")}
          action={() => deleteAssignmentAction(id)}
          successMessage={t("deleted")}
          onSuccess={() => router.push("/assignments")}
        />
      ) : null}
    </>
  );
}
