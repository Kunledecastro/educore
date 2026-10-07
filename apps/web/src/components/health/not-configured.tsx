import { HeartPulse } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** Shown when the server has no HEALTH_DATA_KEY: health records can't be stored or read yet. */
export async function HealthNotConfigured() {
  const t = await getTranslations("health");
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-warning bg-card p-5">
      <HeartPulse className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{t("notConfigured.title")}</p>
        <p className="text-sm text-muted-foreground">{t("notConfigured.body")}</p>
      </div>
    </div>
  );
}
