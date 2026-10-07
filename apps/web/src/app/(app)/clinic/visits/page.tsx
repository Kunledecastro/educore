import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { withRls } from "@educore/db";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { PupilPicker } from "@/components/health/pupil-picker";
import { VisitList } from "@/components/health/visit-list";
import { PageHeader } from "@/components/page-header";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { healthConfigured, healthViewer } from "@/lib/health/data";
import { canRecordVisit } from "@/lib/health/rules";
import { nowLocal, visitFmt } from "@/lib/health/visit-format";
import { dayVisits } from "@/lib/health/visits";
import { getSettingsForUser } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** The clinic's day (Phase 7.2): record a visit, and every visit that day. */
export default async function ClinicVisitsPage({ searchParams }: { searchParams: { date?: string | string[] } }) {
  const ctx = await requirePermission("clinicVisit", "read", { page: true });
  const t = await getTranslations("health");
  const back = (
    <Link href="/clinic" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("visits.backToClinic")}
    </Link>
  );
  if (!healthConfigured()) {
    return (
      <div className="space-y-6">
        {back}
        <HealthNotConfigured />
      </div>
    );
  }
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  const settings = await getSettingsForUser(a.tenantId);
  const today = nowLocal(settings.timezone).slice(0, 10);
  const raw = Array.isArray(searchParams.date) ? searchParams.date[0] : searchParams.date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
  const canRecord = canRecordVisit(viewer);
  const [visits, pupils] = await Promise.all([
    dayVisits(viewer, date),
    canRecord
      ? withRls(a.tenantId, (tx) =>
          tx.student.findMany({
            where: { tenantId: a.tenantId, status: "ACTIVE" },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
            select: { id: true, firstName: true, lastName: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } },
          }),
        )
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={t("visits.title")}
        description={canRecord ? t("visits.descriptionNurse") : t("visits.descriptionAdmin")}
        actions={
          <Link href="/clinic/reports" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            {t("reports.link")}
          </Link>
        }
      />
      {canRecord ? (
        <section className="rounded-lg border bg-card p-5" aria-label={t("visits.record")}>
          <h2 className="mb-3 font-semibold">{t("visits.record")}</h2>
          <PupilPicker pupils={pupils.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, admissionNo: p.admissionNo, classLabel: p.section ? `${p.section.class.name} ${p.section.name}` : "" }))} />
        </section>
      ) : null}
      <section className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" aria-label={t("visits.pickDay")}>
          <div className="space-y-1">
            <label htmlFor="visit-day" className="text-sm font-medium">
              {t("visits.day")}
            </label>
            <input id="visit-day" type="date" name="date" defaultValue={date} max={today} className="h-9 rounded-md border bg-background px-3 text-sm" />
          </div>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
            {t("visits.show")}
          </button>
        </form>
        <h2 className="font-semibold">{t("visits.dayCount", { count: visits.length })}</h2>
        <VisitList visits={visits} fmt={visitFmt(settings)} showPupil editable={canRecord} empty={t("visits.noneThisDay")} />
      </section>
    </div>
  );
}
