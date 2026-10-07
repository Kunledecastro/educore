import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { requirePermission } from "@/lib/guard";
import { healthConfigured, healthSettings } from "@/lib/health/data";
import { HealthSettingsForm } from "./controls";

/** Settings → Health (Phase 7.0): whether school admins may open full records, and how long records are kept. */
export default async function HealthSettingsPage() {
  const ctx = await requirePermission("healthSettings", "update", { page: true });
  const [settings, t] = await Promise.all([healthSettings(ctx.user.tenantId!), getTranslations("health.settings")]);
  return (
    <div className="space-y-6">
      {!healthConfigured() ? <HealthNotConfigured /> : null}
      <section className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby="health-settings">
        <h2 id="health-settings" className="font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("explain")}</p>
        <HealthSettingsForm initial={settings} impersonating={Boolean(ctx.impersonation)} />
      </section>
      <p className="text-sm">
        <Link href="/clinic/access-log" className="underline underline-offset-2">
          {t("accessLogLink")}
        </Link>
      </p>
    </div>
  );
}
