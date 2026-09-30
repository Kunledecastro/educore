"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog } from "@/components/form/form-dialog";
import { deleteClass, deleteSection } from "../actions";
import { ClassForm, SectionForm } from "./forms";

export interface ClassCardData {
  id: string;
  academicYearId: string;
  name: string;
  order: number;
  studentCount: number;
  sections: {
    id: string;
    name: string;
    capacity: number | null;
    studentCount: number;
    formTeacherId: string | null;
    formTeacherName: string | null;
  }[];
}

export type TeacherOption = { id: string; name: string };

export function ClassCard({ cls, teachers }: { cls: ClassCardData; teachers: TeacherOption[] }) {
  const t = useTranslations("academics.classes");
  const ts = useTranslations("academics.sections");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{cls.name}</CardTitle>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {t("students", { count: cls.studentCount })}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${cls.name}`}>
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
      </CardHeader>
      <CardContent className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("sections")}</h3>
        {cls.sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSections")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {cls.sections.map((s) => (
              <SectionRow key={s.id} classId={cls.id} className={cls.name} section={s} teachers={teachers} />
            ))}
          </ul>
        )}
        <FormDialog
          title={`${ts("new")} · ${cls.name}`}
          trigger={
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {ts("new")}
            </Button>
          }
        >
          {(close) => <SectionForm classId={cls.id} teachers={teachers} onDone={close} />}
        </FormDialog>
      </CardContent>

      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <ClassForm academicYearId={cls.academicYearId} cls={cls} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: cls.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteClass(cls.id)}
        successMessage={t("deleted")}
      />
    </Card>
  );
}

function SectionRow({
  classId,
  className,
  section,
  teachers,
}: {
  classId: string;
  className: string;
  section: ClassCardData["sections"][number];
  teachers: TeacherOption[];
}) {
  const t = useTranslations("academics.sections");
  const tcl = useTranslations("academics.classes");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const label = `${className} ${section.name}`;

  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{section.name}</span>
        <span className="ml-2 text-muted-foreground">
          {tcl("students", { count: section.studentCount })}
          {section.capacity ? ` · ${t("capacityValue", { count: section.capacity })}` : ""}
        </span>
        <span className="block text-xs text-muted-foreground">
          {section.formTeacherName ? t("formTeacherValue", { name: section.formTeacherName }) : t("noFormTeacher")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(true)} aria-label={`${tc("edit")}: ${label}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => setDeleting(true)}
          aria-label={`${tc("delete")}: ${label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <SectionForm classId={classId} section={section} teachers={teachers} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: label })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteSection(section.id)}
        successMessage={t("deleted")}
      />
    </li>
  );
}
