import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { VisitForm } from "@/components/health/visit-form";
import { PageHeader } from "@/components/page-header";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { pupilAlerts } from "@/lib/health/alerts";
import { HealthError, healthConfigured, healthViewer, pupilInSchool } from "@/lib/health/data";
import { canRecordVisit } from "@/lib/health/rules";
import { nowLocal } from "@/lib/health/visit-format";
import { visitForEdit } from "@/lib/health/visits";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/** Correct a clinic visit — e.g. add the time they left and the outcome (the nurse, Phase 7.2). */
export default async function EditVisitPage({ params }: { params: { id: string } }) {
  const ctx = await requirePermission("clinicVisit", "update", { page: true });
  const t = await getTranslations("health.visits");
  if (!healthConfigured()) return <HealthNotConfigured />;
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  if (!canRecordVisit(viewer)) redirect("/clinic/visits");
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const visit = await visitForEdit(viewer, id.data).catch((err) => {
    if (err instanceof HealthError) notFound();
    throw err;
  });
  const pupil = await pupilInSchool(a.tenantId, visit.studentId);
  if (!pupil) notFound();
  const [alerts, settings] = await Promise.all([pupilAlerts(viewer, pupil.id), getSettingsForUser(a.tenantId)]);
  const name = `${pupil.firstName} ${pupil.lastName}`;
  return (
    <div className="space-y-6">
      <Link href={`/clinic/${pupil.id}`} className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToRecord")}
      </Link>
      <PageHeader title={t("editTitle", { name })} />
      <VisitForm studentId={pupil.id} pupilName={name} visitId={id.data} initial={visit.values} alerts={alerts.map((x) => ({ category: x.category, severity: x.severity, text: x.text }))} nowLocal={nowLocal(settings.timezone)} />
    </div>
  );
}
