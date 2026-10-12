"use client";

import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { loadSampleDataAction, removeSampleDataAction } from "@/app/(app)/dashboard/actions";

/** "Try it with sample data" for a fresh school, or "remove sample data" once loaded (tester review, Oct 2026). */
export function SampleDataCard({ loaded, pupils }: { loaded: boolean; pupils: number }) {
  const t = useTranslations("sampleData");
  const router = useRouter();
  return (
    <section aria-labelledby="sample-title" className={`flex flex-wrap items-start gap-4 rounded-lg border p-4 ${loaded ? "border-warning bg-warning/10" : "bg-card"}`}>
      <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <h2 id="sample-title" className="font-semibold">
          {loaded ? t("loadedTitle") : t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{loaded ? t("loadedBody", { pupils }) : t("body")}</p>
      </div>
      {loaded ? (
        <ConfirmAction
          trigger={
            <Button type="button" variant="outline" size="sm">
              {t("remove")}
            </Button>
          }
          title={t("removeTitle")}
          description={t("removeDescription")}
          confirmLabel={t("remove")}
          action={() => removeSampleDataAction()}
          successMessage={t("removed")}
          onSuccess={() => router.refresh()}
        />
      ) : (
        <ConfirmAction
          trigger={
            <Button type="button" size="sm">
              {t("load")}
            </Button>
          }
          title={t("loadTitle")}
          description={t("loadDescription")}
          confirmLabel={t("load")}
          destructive={false}
          action={() => loadSampleDataAction()}
          successMessage={t("loaded")}
          onSuccess={() => router.refresh()}
        />
      )}
    </section>
  );
}
