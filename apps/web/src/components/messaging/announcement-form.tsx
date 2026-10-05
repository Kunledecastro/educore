"use client";

import { Megaphone, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { createAnnouncementAction, deleteAnnouncementAction, updateAnnouncementAction } from "@/app/(app)/announcements/actions";
import { ANNOUNCEMENT_ROLES, announcementSchema, type AnnouncementFormInput } from "@/lib/validation/messaging";

export interface AnnouncementOptions {
  /** Classes this person may address. */
  classes: { id: string; name: string }[];
  /** Admins: whole school, a role, pinning. Teachers: their classes only. */
  isAdmin: boolean;
}

export function NewAnnouncementButton({ options }: { options: AnnouncementOptions }) {
  const t = useTranslations("announcements");
  return (
    <FormDialog
      title={t("new")}
      trigger={
        <Button>
          <Megaphone className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <AnnouncementForm options={options} onDone={close} />}
    </FormDialog>
  );
}

export function EditAnnouncementButton({ id, initial, options }: { id: string; initial: AnnouncementFormInput; options: AnnouncementOptions }) {
  const t = useTranslations("announcements");
  return (
    <FormDialog
      title={t("edit")}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("editNamed", { title: initial.title })}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
    >
      {(close) => <AnnouncementForm id={id} initial={initial} options={options} onDone={close} />}
    </FormDialog>
  );
}

export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations("announcements");
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("deleteNamed", { title })}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
      title={t("deleteTitle")}
      description={t("deleteDescription", { title })}
      confirmLabel={t("delete")}
      action={() => deleteAnnouncementAction(id)}
      successMessage={t("deleted")}
    />
  );
}

function AnnouncementForm({ id, initial, options, onDone }: { id?: string; initial?: AnnouncementFormInput; options: AnnouncementOptions; onDone: () => void }) {
  const t = useTranslations("announcements");
  const tr = useTranslations("roles");
  const defaults: AnnouncementFormInput = initial ?? {
    title: "",
    body: "",
    audienceScope: options.isAdmin ? "SCHOOL" : "CLASS",
    audienceClassId: options.isAdmin ? "" : options.classes[0]?.id ?? "",
    audienceRole: "",
    isPinned: false,
  } as AnnouncementFormInput;
  const { form, onSubmit, pending, fieldError } = useServerForm<AnnouncementFormInput>({
    schema: announcementSchema,
    defaultValues: defaults,
    submit: (v) => (id ? updateAnnouncementAction(id, v) : createAnnouncementAction(v)),
    successMessage: id ? t("saved") : t("posted"),
    onSuccess: onDone,
  });
  const scope = form.watch("audienceScope");
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("title")} htmlFor="an-title" error={fieldError("title")} required>
        <Input id="an-title" maxLength={150} autoFocus {...form.register("title")} />
      </FormField>
      <FormField label={t("body")} htmlFor="an-body" error={fieldError("body")} required>
        <Textarea id="an-body" rows={6} maxLength={5000} {...form.register("body")} />
      </FormField>
      {options.isAdmin ? (
        <FormField label={t("audience")} htmlFor="an-scope" error={fieldError("audienceScope")} required>
          <Select id="an-scope" {...form.register("audienceScope")}>
            <option value="SCHOOL">{t("audiences.SCHOOL")}</option>
            <option value="CLASS">{t("audiences.CLASS")}</option>
            <option value="ROLE">{t("audiences.ROLE")}</option>
          </Select>
        </FormField>
      ) : null}
      {scope === "CLASS" ? (
        <FormField label={t("class")} htmlFor="an-class" error={fieldError("audienceClassId")} hint={t("classHint")} required>
          <Select id="an-class" {...form.register("audienceClassId")}>
            <option value="">{t("chooseClass")}</option>
            {options.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {scope === "ROLE" ? (
        <FormField label={t("role")} htmlFor="an-role" error={fieldError("audienceRole")} required>
          <Select id="an-role" {...form.register("audienceRole")}>
            <option value="">{t("chooseRole")}</option>
            {ANNOUNCEMENT_ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {options.isAdmin ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" {...form.register("isPinned")} />
          {t("pin")}
        </label>
      ) : null}
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={id ? t("save") : t("post")} />
    </form>
  );
}
