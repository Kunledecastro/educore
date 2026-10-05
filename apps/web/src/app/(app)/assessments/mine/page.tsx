import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { PageHeader } from "@/components/page-header";
import { StudentResultsCard } from "@/components/results/student-results-card";
import { requireModule } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";

/** A student's own results (published terms only). */
export default async function MyResultsPage() {
  const { user, db } = await requireModule("assessments");
  if (user.role !== Role.STUDENT) redirect("/assessments");
  const t = await getTranslations("gradebook");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const me = await db.student.findUnique({ where: { userId: user.id }, select: { id: true, classId: true, academicYearId: true } });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("myResults")} />
      {me?.academicYearId ? (
        <StudentResultsCard db={db} student={{ id: me.id, classId: me.classId }} yearId={me.academicYearId} viewerRole={user.role} settings={settings} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("notYetPublished")}</p>
      )}
    </div>
  );
}
