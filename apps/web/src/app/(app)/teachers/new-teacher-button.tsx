"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { FormDialog } from "@/components/form/form-dialog";
import { StaffForm, TeacherForm } from "@/components/people/person-forms";

export function NewPersonButton({ kind }: { kind: "teacher" | "staff" }) {
  const t = useTranslations(kind === "teacher" ? "teachers" : "staff");
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
      {(close) => (kind === "teacher" ? <TeacherForm onDone={close} /> : <StaffForm onDone={close} />)}
    </FormDialog>
  );
}
