import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/guard";
import { SettingsTabs } from "./tabs";

/**
 * School settings (milestone 2.0): terms, grading scale, score components,
 * options. School admins only; every page and action re-checks its own
 * permission. Other roles see the (future) personal-settings placeholder.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  if (!can(ctx.user.role, "academicSettings", "update")) return <ComingSoon navKey="settings" phase="phase4" />;
  const t = await getTranslations("settings");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsTabs />
      {children}
    </div>
  );
}
