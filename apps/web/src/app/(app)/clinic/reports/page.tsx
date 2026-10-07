import Link from "next/link";
import { ArrowLeft, FileDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { PageHeader } from "@/components/page-header";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { healthConfigured, healthViewer } from "@/lib/health/data";
import { nowLocal } from "@/lib/health/visit-format";
import { visitReport } from "@/lib/health/visits";
import { getSettingsForUser } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined) {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function Bars({ title, rows, total }: { title: string; rows: { label: string; count: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="space-y-2 rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="w-1/3 py-1 pr-3 text-left font-normal">
                  {r.label}
                </th>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 rounded bg-primary" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} aria-hidden="true" />
                    <span className="tabular-nums">{r.count}</span>
                    <span className="text-xs text-muted-foreground">({total ? Math.round((r.count / total) * 100) : 0}%)</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Clinic reports (Phase 7.2): counts only — visits per day and class, top complaints, outcomes, medicines used. */
export default async function ClinicReportsPage({ searchParams }: { searchParams: { from?: string | string[]; to?: string | string[] } }) {
  const ctx = await requirePermission("clinicVisit", "read", { page: true });
  const t = await getTranslations("health");
  const back = (
    <Link href="/clinic/visits" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("visits.backToLog")}
    </Link>
  );
  if (!healthConfigured()) return <div className="space-y-6">{back}<HealthNotConfigured /></div>;
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  const settings = await getSettingsForUser(a.tenantId);
  const today = nowLocal(settings.timezone).slice(0, 10);
  const monthAgo = new Date(`${today}T00:00:00Z`);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 29);
  let from = one(searchParams.from) ?? monthAgo.toISOString().slice(0, 10);
  let to = one(searchParams.to) ?? today;
  if (to < from) [from, to] = [to, from];
  const r = await visitReport(viewer, { from, to });
  const pct = (n: number) => (r.total ? Math.round((n / r.total) * 100) : 0);
  const urgent = r.byOutcome.filter((x) => x.key === "SENT_HOME" || x.key === "REFERRED").reduce((n, x) => n + x.count, 0);
  const qs = `from=${from}&to=${to}`;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={t("reports.title")}
        description={t("reports.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/health/visits-report?${qs}&format=xlsx`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Excel
            </a>
            <a href={`/api/health/visits-report?${qs}&format=csv`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <FileDown className="h-4 w-4" aria-hidden="true" />
              CSV
            </a>
          </div>
        }
      />
      <form className="flex flex-wrap items-end gap-3" aria-label={t("reports.range")}>
        <div className="space-y-1">
          <label htmlFor="r-from" className="text-sm font-medium">
            {t("reports.from")}
          </label>
          <input id="r-from" type="date" name="from" defaultValue={from} max={today} className="h-9 rounded-md border bg-background px-3 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor="r-to" className="text-sm font-medium">
            {t("reports.to")}
          </label>
          <input id="r-to" type="date" name="to" defaultValue={to} max={today} className="h-9 rounded-md border bg-background px-3 text-sm" />
        </div>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
          {t("reports.show")}
        </button>
      </form>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{t("reports.allVisits")}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{r.total}</dd>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{t("reports.backToClass")}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{pct(r.byOutcome.find((x) => x.key === "BACK_TO_CLASS")?.count ?? 0)}%</dd>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{t("reports.sentHomeOrReferred")}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{urgent}</dd>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{t("reports.medicinesGiven")}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{r.byMedicine.reduce((n, x) => n + x.count, 0)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("reports.anonymous")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title={t("reports.byComplaint")} total={r.total} rows={r.byComplaint.map((x) => ({ label: t(`visits.complaints.${x.key}`), count: x.count }))} />
        <Bars title={t("reports.byOutcome")} total={r.total} rows={r.byOutcome.map((x) => ({ label: x.key === "OPEN" ? t("visits.stillHere") : t(`visits.outcomes.${x.key}`), count: x.count }))} />
        <Bars title={t("reports.byClass")} total={r.total} rows={r.byClass.map((x) => ({ label: x.label, count: x.count }))} />
        <Bars title={t("reports.byMedicine")} total={r.byMedicine.reduce((n, x) => n + x.count, 0)} rows={r.byMedicine.map((x) => ({ label: x.key === "own" ? t("reports.ownMedicine") : t(`profile.medicines.${x.key}` as never), count: x.count }))} />
        <Bars title={t("reports.byDay")} total={r.total} rows={r.byDay.map((x) => ({ label: x.day, count: x.count }))} />
      </div>
    </div>
  );
}
