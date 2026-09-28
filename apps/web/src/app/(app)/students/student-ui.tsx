"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, MoreHorizontal, Pencil, Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog } from "@/components/form/form-dialog";
import { STUDENT_STATUSES } from "@/lib/validation/people";
import { setStudentStatus } from "./actions";
import { StudentForm, type ClassOption, type StudentFormData } from "./student-form";

export function NewStudentButton({ classes }: { classes: ClassOption[] }) {
  const t = useTranslations("students");
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
      {(close) => <StudentForm classes={classes} onDone={close} />}
    </FormDialog>
  );
}

export function EditStudentButton({ classes, student }: { classes: ClassOption[]; student: StudentFormData }) {
  const t = useTranslations("students");
  return (
    <FormDialog
      title={t("edit")}
      trigger={
        <Button variant="outline">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t("edit")}
        </Button>
      }
    >
      {(close) => <StudentForm classes={classes} student={student} onDone={close} />}
    </FormDialog>
  );
}

/** Status change with confirmation — students are never deleted. */
export function StatusMenuItems({
  student,
  onPick,
}: {
  student: { status: string };
  onPick: (status: (typeof STUDENT_STATUSES)[number]) => void;
}) {
  const t = useTranslations("students");
  return (
    <>
      {STUDENT_STATUSES.filter((s) => s !== student.status).map((s) => (
        <DropdownMenuItem key={s} onSelect={() => onPick(s)}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("statuses." + s)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function useStatusChange(student: { id: string; name: string }) {
  const t = useTranslations("students");
  const [target, setTarget] = React.useState<(typeof STUDENT_STATUSES)[number] | null>(null);
  const dialog = (
    <ConfirmAction
      open={target !== null}
      onOpenChange={(o) => (o ? null : setTarget(null))}
      title={t("statusTitle", { name: student.name, status: target ? t(`statuses.${target}`) : "" })}
      description={t("statusDescription")}
      confirmLabel={t("changeStatus")}
      destructive={target !== "ACTIVE"}
      action={() => setStudentStatus(student.id, target)}
      successMessage={t("statusChanged")}
    />
  );
  return { pick: setTarget, dialog };
}

export function StudentRowActions({
  classes,
  student,
}: {
  classes: ClassOption[];
  student: StudentFormData & { name: string; status: string };
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const status = useStatusChange(student);
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${student.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/students/${student.id}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t("view")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {tc("edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <StatusMenuItems student={student} onPick={status.pick} />
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <StudentForm classes={classes} student={student} onDone={close} />}
      </FormDialog>
      {status.dialog}
    </div>
  );
}
