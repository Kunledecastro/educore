"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { FormDialog } from "@/components/form/form-dialog";
import { ClassForm } from "./forms";

export function NewClassButton({ academicYearId, yearName }: { academicYearId: string; yearName: string }) {
  const t = useTranslations("academics.classes");
  return (
    <FormDialog
      title={`${t("new")} · ${yearName}`}
      trigger={
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <ClassForm academicYearId={academicYearId} onDone={close} />}
    </FormDialog>
  );
}
