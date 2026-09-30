"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { publishResults, unpublishResults } from "./actions";

export function PublishControls({
  classId,
  termId,
  label,
  published,
  missingScores,
  disabled,
}: {
  classId: string;
  termId: string;
  label: string;
  published: boolean;
  missingScores: number;
  disabled: boolean;
}) {
  const t = useTranslations("gradebook.publish");
  return published ? (
    <ConfirmAction
      trigger={
        <Button variant="outline">
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          {t("unpublish")}
        </Button>
      }
      title={t("unpublishTitle", { label })}
      description={t("unpublishDescription")}
      confirmLabel={t("unpublish")}
      action={() => unpublishResults({ classId, termId })}
      successMessage={t("unpublished", { label })}
    />
  ) : (
    <ConfirmAction
      trigger={
        <Button disabled={disabled}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          {t("publish")}
        </Button>
      }
      title={t("publishTitle", { label })}
      description={
        <>
          {t("publishDescription")}
          {missingScores > 0 ? <span className="mt-2 block font-medium text-destructive">{t("publishMissing", { count: missingScores })}</span> : null}
        </>
      }
      confirmLabel={t("publish")}
      destructive={false}
      action={() => publishResults({ classId, termId })}
      successMessage={t("publishedDone", { label })}
    />
  );
}
