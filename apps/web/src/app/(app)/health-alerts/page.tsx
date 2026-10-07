import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown, HeartPulse } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { PageHeader } from "@/components/page-header";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { alertsBoard } from "@/lib/health/alerts";
import { healthConfigured, healthViewer } from "@/lib/health/data";

export const dynamic = "force-dynamic";

const VARIANT = { SEVERE: "destructive", MODERATE: "warning", MILD: "secondary" } as const;

/**
 * Health alerts (Phase 7.1): every pupil with an alert, by class, and the
 * class emergency cards for trips. Teachers see their own classes; the
 * nurse and admins the whole school. Alerts only — never the record.
 */
export default async function HealthAlertsPage() {
  const ctx = await requirePermission("healthAlert", "read", { page: true });
  if (ctx.user.role === "PARENT") redirect("/health");
  const t = await getTranslations("health");
  if (!healthConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("alerts.pageTitle")} />
        <HealthNotConfigured />
      </div>
    );
  }
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  if (viewer.impersonating) redirect("/dashboard");
  const board = await alertsBoard(viewer);
  const isClinic = viewer.role === "SCHOOL_NURSE" || viewer.role === "SCHOOL_ADMIN";
  const total = board.reduce((n, s) => n + s.pupils.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("alerts.pageTitle")} description={viewer.role === "TEACHER" ? t("alerts.pageTeacher") : t("alerts.pageClinic")} />
      {board.length === 0 ? (
        <EmptyState icon={<HeartPulse className="h-8 w-8" aria-hidden="true" />} title={t("alerts.noClasses")} />
      ) : (
        <>
          {total === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("alerts.noneAnywhere")}</p> : null}
          {board.map((s) => (
            <section key={s.sectionId} className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby={`sec-${s.sectionId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`sec-${s.sectionId}`} className="font-semibold">
                  {s.label} <span className="text-sm font-normal text-muted-foreground">· {t("alerts.pupilCount", { count: s.pupils.length })}</span>
                </h2>
                <a href={`/api/health/card?section=${s.sectionId}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                  {t("card.downloadClass")}
                </a>
              </div>
              {s.pupils.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("alerts.noneInClass")}</p>
              ) : (
                <ul className="divide-y">
                  {s.pupils.map((p) => (
                    <li key={p.id} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
                      <div>
                        {isClinic ? (
                          <Link href={`/clinic/${p.id}`} className="font-medium underline-offset-2 hover:underline">
                            {p.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{p.name}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">{p.admissionNo}</span>
                      </div>
                      <ul className="space-y-1">
                        {p.alerts.map((al) => (
                          <li key={al.id} className="text-sm">
                            <Badge variant={VARIANT[al.severity]} className="mr-2">
                              {t(`alerts.severity.${al.severity}`)}
                            </Badge>
                            <span className="font-medium">{t(`alerts.category.${al.category}`)}:</span> {al.text}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("alerts.pageFooter")}</p>
    </div>
  );
}
