import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { VisitForm } from "@/components/health/visit-form";
import { PageHeader } from "@/components/page-header";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { pupilAlerts } from "@/lib/health/alerts";
import { healthConfigured, healthViewer, pupilInSchool } from "@/lib/health/data";
import { canRecordVisit } from "@/lib/health/rules";
import { nowLocal } from "@/lib/health/visit-format";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/** Record a clinic visit for one pupil (the nurse, Phase 7.2). */
export default async function NewVisitPage({ searchParams }: { searchParams: { student?: string | string[] } }) {
  const ctx = await requirePermission("clinicVisit", "create", { page: true });
  const t = await getTranslations("health.visits");
  if (!healthConfigured()) return <HealthNotConfigured />;
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  if (!canRecordVisit(viewer)) redirect("/clinic/visits");
  const sid = idSchema.safeParse(Array.isArray(searchParams.student) ? searchParams.student[0] : searchParams.student);
  if (!sid.success) redirect("/clinic/visits");
  const pupil = await pupilInSchool(a.tenantId, sid.data);
  if (!pupil || pupil.status !== "ACTIVE") notFound();
  const [alerts, settings] = await Promise.all([pupilAlerts(viewer, pupil.id), getSettingsForUser(a.tenantId)]);
  const name = `${pupil.firstName} ${pupil.lastName}`;
  return (
    <div className="space-y-6">
      <Link href="/clinic/visits" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToLog")}
      </Link>
      <PageHeader title={t("newTitle", { name })} />
      <VisitForm studentId={pupil.id} pupilName={name} alerts={alerts.map((x) => ({ category: x.category, severity: x.severity, text: x.text }))} nowLocal={nowLocal(settings.timezone)} />
    </div>
  );
}
