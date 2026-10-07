import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AlertsSection } from "@/components/health/alerts-section";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { RecordPanel } from "@/components/health/record-panel";
import { formatDateTime } from "@/lib/format";
import { pupilAlerts } from "@/lib/health/alerts";
import { HealthError, openRecord } from "@/lib/health/data";
import { canManageAlerts, canRecordVisit } from "@/lib/health/rules";
import { visitFmt } from "@/lib/health/visit-format";
import { listVisits } from "@/lib/health/visits";
import { VisitList } from "@/components/health/visit-list";
import { healthPage } from "@/lib/health/page";
import { objectStore } from "@/lib/storage/object-store";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

/**
 * One pupil's health record — shared by the clinic (/clinic/[id]) and by
 * parents (/health/[id]). Opening it is logged; anyone who may not open it
 * gets a plain 404.
 */
export async function HealthRecordPage({ studentId, backHref }: { studentId: string; backHref: string }) {
  const { viewer, meta, configured } = await healthPage("read");
  const t = await getTranslations("health");
  const back = (
    <Link href={backHref} className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );
  if (!configured) {
    return (
      <div className="space-y-6">
        {back}
        <HealthNotConfigured />
      </div>
    );
  }
  const id = idSchema.safeParse(studentId);
  if (!id.success) notFound();
  let record;
  try {
    record = await openRecord(viewer, id.data, meta);
  } catch (err) {
    if (err instanceof HealthError) notFound();
    throw err;
  }
  const [settings, alerts, visits] = await Promise.all([getSettingsForUser(viewer.tenantId), pupilAlerts(viewer, record.student.id), listVisits(viewer, { studentId: record.student.id, take: 30 })]);
  const when = (d: Date) => formatDateTime(d, settings);
  const p = record.profile;
  const mode = viewer.role === "PARENT" ? "parent" : viewer.role === "SCHOOL_NURSE" ? "nurse" : "admin";

  return (
    <div className="space-y-6">
      {back}
      <header className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">{record.student.name}</h1>
          <a href={`/api/health/card?student=${record.student.id}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {t("card.download")}
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          {record.student.admissionNo}
          {record.student.className ? ` · ${record.student.className}` : ""}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {mode === "parent" ? t("privacyParent") : t("privacyStaff")}
        </p>
      </header>
      <AlertsSection studentId={record.student.id} alerts={alerts.map((a) => ({ id: a.id, category: a.category, severity: a.severity, text: a.text }))} canManage={canManageAlerts(viewer)} />
      <RecordPanel
        studentId={record.student.id}
        mode={mode}
        canEdit={record.canEdit}
        canVerify={record.canVerify}
        storageReady={objectStore.configured()}
        contacts={record.contacts.map((c) => ({ name: c.name, relationship: c.relationship ?? "", phone: c.phone, altPhone: c.altPhone ?? "" }))}
        documents={record.documents.map((d) => ({ id: d.id, fileName: d.fileName, sizeBytes: d.sizeBytes }))}
        profile={
          p
            ? {
                data: p.data,
                status: p.status,
                consentText:
                  p.consent.source === "PAPER"
                    ? t("consent.recordedPaper", { name: p.consent.byName ?? "—", date: when(p.consent.at) })
                    : t("consent.recordedOnline", { name: p.consent.byName ?? "—", date: when(p.consent.at) }),
                verifiedText: p.status === "VERIFIED" && p.verifiedAt ? t("verifiedBy", { name: p.verifiedByName ?? "—", date: when(p.verifiedAt) }) : null,
              }
            : null
        }
      />
      <section className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby="clinic-visits">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="clinic-visits" className="font-semibold">
            {t("visits.recordTitle")}
          </h2>
          {canRecordVisit(viewer) ? (
            <Link href={`/clinic/visits/new?student=${record.student.id}`} className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              {t("visits.record")}
            </Link>
          ) : null}
        </div>
        <VisitList visits={visits} fmt={visitFmt(settings)} editable={canRecordVisit(viewer)} />
      </section>
    </div>
  );
}
