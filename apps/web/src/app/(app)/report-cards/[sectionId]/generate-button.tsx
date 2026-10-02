"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { generateReportCardsAction } from "../actions";

export function GenerateButton({
  sectionId,
  termId,
  label,
  regenerate,
  disabled,
}: {
  sectionId: string;
  termId: string;
  label: string;
  regenerate: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("reportCards");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button disabled={disabled}>
          <FileText className="h-4 w-4" aria-hidden="true" />
          {regenerate ? t("regenerate") : t("generate")}
        </Button>
      }
      title={t("generateTitle", { section: label })}
      description={t("generateDescription")}
      confirmLabel={regenerate ? t("regenerate") : t("generate")}
      destructive={false}
      action={async () => {
        const result = await generateReportCardsAction({ sectionId, termId });
        if (result.ok) router.refresh();
        return result;
      }}
      successMessage={t("generateQueued")}
    />
  );
}
