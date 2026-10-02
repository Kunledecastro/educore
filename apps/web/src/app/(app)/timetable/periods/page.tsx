import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/guard";
import { loadPeriods } from "@/lib/timetable-data";
import { TimetableTabs } from "../tabs";
import { PeriodsEditor } from "./periods-editor";

export default async function BellSchedulePage() {
  const ctx = await requirePermission("timetable", "update");
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  const t = await getTranslations("timetable");
  const periods = await loadPeriods(ctx.db);
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <TimetableTabs />
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">{t("periods.intro")}</p>
        <PeriodsEditor
          isNew={periods.length === 0}
          initial={periods.map(({ label, startTime, endTime, isBreak }) => ({ label, startTime, endTime, isBreak }))}
        />
      </div>
    </div>
  );
}
