import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/guard";
import { AcademicsTabs } from "./tabs";

export default async function AcademicsLayout({ children }: { children: React.ReactNode }) {
  // Each page re-checks its own permission; this stops non-admin roles at the door.
  const ctx = await requirePermission("academicYear", "update");
  // Academic setup is per school. Platform admins manage schools, not their timetables.
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  const t = await getTranslations("academics");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <AcademicsTabs />
      {children}
    </div>
  );
}
