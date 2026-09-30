"use client";

import * as React from "react";
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { Input } from "@educore/ui/input";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { termSchema, type TermFormInput } from "@/lib/validation/settings";
import { addSuggestedTerms, createTerm, deleteTerm, setCurrentTerm, updateTerm } from "./actions";

type YearInfo = { id: string; name: string; startDate: string; endDate: string };
type TermInfo = { id: string; name: string; startDate: string; endDate: string };

export function NewTermButton({ year, variant = "default" }: { year: YearInfo; variant?: "default" | "outline" }) {
  const t = useTranslations("settings.terms");
  return (
    <FormDialog
      title={`${t("new")} · ${year.name}`}
      trigger={
        <Button variant={variant}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <TermForm year={year} onDone={close} />}
    </FormDialog>
  );
}

export function AddSuggestedTermsButton({ yearId, yearName }: { yearId: string; yearName: string }) {
  const t = useTranslations("settings.terms");
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await addSuggestedTerms(yearId);
          if (result.ok) toast.success(t("suggestedAdded", { year: yearName }));
          else toast.error(result.error);
        })
      }
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      {pending ? t("adding") : t("addSuggested")}
    </Button>
  );
}

export function TermRowActions({ year, term, canSetCurrent }: { year: YearInfo; term: TermInfo; canSetCurrent: boolean }) {
  const t = useTranslations("settings.terms");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <div className="flex justify-end gap-1">
      {canSetCurrent ? (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("setCurrent")}</span>
            </Button>
          }
          title={t("setCurrentTitle", { name: term.name })}
          description={t("setCurrentDescription", { name: term.name })}
          confirmLabel={t("setCurrent")}
          destructive={false}
          action={() => setCurrentTerm(term.id)}
          successMessage={t("setCurrentDone", { name: term.name })}
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${term.name}`}>
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
        {(close) => <TermForm year={year} term={term} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: term.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteTerm(term.id)}
        successMessage={t("deleted")}
      />
    </div>
  );
}

function TermForm({ year, term, onDone }: { year: YearInfo; term?: TermInfo; onDone: () => void }) {
  const t = useTranslations("settings.terms");
  const { form, onSubmit, pending, fieldError } = useServerForm<TermFormInput>({
    schema: termSchema,
    defaultValues: { academicYearId: year.id, name: term?.name ?? "", startDate: term?.startDate ?? "", endDate: term?.endDate ?? "" },
    submit: (values) => (term ? updateTerm(term.id, values) : createTerm(values)),
    successMessage: term ? t("updated") : t("created"),
    onSuccess: onDone,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("academicYearId")} />
      <FormField label={t("name")} htmlFor="term-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus {...form.register("name")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("startDate")} htmlFor="term-start" error={fieldError("startDate")} required>
          <Input type="date" min={year.startDate} max={year.endDate} {...form.register("startDate")} />
        </FormField>
        <FormField label={t("endDate")} htmlFor="term-end" error={fieldError("endDate")} required>
          <Input type="date" min={year.startDate} max={year.endDate} {...form.register("endDate")} />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("withinYear", { year: year.name })}</p>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
