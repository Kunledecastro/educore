"use client";

import * as React from "react";
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog } from "@/components/form/form-dialog";
import { deleteAcademicYear, setActiveAcademicYear } from "./actions";
import { YearForm } from "./year-form";

export function NewYearButton({ first = false }: { first?: boolean }) {
  const t = useTranslations("academics.years");
  return (
    <FormDialog
      title={t("new")}
      description={first ? t("firstIsActive") : undefined}
      trigger={
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <YearForm onDone={close} />}
    </FormDialog>
  );
}

export function YearRowActions({ year }: { year: { id: string; name: string; startDate: string; endDate: string; isActive: boolean } }) {
  const t = useTranslations("academics.years");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <div className="flex justify-end gap-1">
      {!year.isActive ? (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t("setActive")}
            </Button>
          }
          title={t("setActiveTitle", { name: year.name })}
          description={t("setActiveDescription", { name: year.name })}
          confirmLabel={t("setActive")}
          destructive={false}
          action={() => setActiveAcademicYear(year.id)}
          successMessage={t("setActiveDone", { name: year.name })}
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${year.name}`}>
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
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: year.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteAcademicYear(year.id)}
        successMessage={t("deleted")}
      />
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <YearForm year={year} onDone={close} />}
      </FormDialog>
    </div>
  );
}
