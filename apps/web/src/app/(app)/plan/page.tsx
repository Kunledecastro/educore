import { Check, Minus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { PageHeader } from "@/components/page-header";
import { PLATFORM_FORMAT } from "@/components/platform/display";
import { cheapestPlanWith, STATE_VARIANT } from "@/components/plan/display";
import { MODULES, monthlyChargeMinor, type Module } from "@/lib/entitlements";
import { countActiveStudents, loadPlans } from "@/lib/entitlements-data";
import { getEntitlements } from "@/lib/entitlements-server";
import { formatDateOnly, formatMoney, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { redirect } from "next/navigation";

/**
 * "Your plan" (4.1): what the school is on, what it includes, how close it is
 * to the student limit, and what the other plans cost. Everyone can open it
 * (a module page sends them here with ?need=…); prices and the catalogue are
 * for school admins. Plan prices are in naira — EduCore bills in NGN.
 */
export default async function PlanPage({ searchParams }: { searchParams: { need?: string } }) {
  const { user, db } = await requireUser();
  if (!user.tenantId) redirect("/platform/plans");
  const [e, plans, active, t, tm] = await Promise.all([
    getEntitlements(user.tenantId),
    loadPlans(),
    countActiveStudents(db, user.tenantId),
    getTranslations("plan"),
    getTranslations("plan.modules"),
  ]);
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const fmt = PLATFORM_FORMAT;
  const current = plans.find((p) => p.code === e.plan)!;
  const need = (MODULES as readonly string[]).includes(searchParams.need ?? "") ? (searchParams.need as Module) : null;
  const suggestion = need ? cheapestPlanWith(plans, need) : null;
  const money = (minor: number) => formatMoney(minor / 100, fmt);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {need ? (
        <p role="status" className="rounded-md border border-warning bg-warning/10 p-4 text-sm">
          {t("need", { module: tm(need), plan: current.name })}{" "}
          {isAdmin ? (suggestion ? t("needUpgrade", { plan: suggestion.name }) : null) : t("askAdmin")}
        </p>
      ) : null}
      {searchParams.need === "renew" || e.state === "readOnly" ? (
        <p role="status" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {isAdmin ? t("banner.readOnlyAdmin") : t("banner.readOnly")}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle>{current.name}</CardTitle>
          <Badge variant={STATE_VARIANT[e.state]}>{t(`states.${e.state}`)}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("students")}</dt>
              <dd className="mt-1 font-semibold">
                {e.maxStudents === null
                  ? t("studentsUnlimited", { count: formatNumber(active, fmt) })
                  : t("studentsOf", { count: formatNumber(active, fmt), max: formatNumber(e.maxStudents, fmt) })}
              </dd>
              {e.maxStudents !== null ? (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={e.maxStudents} aria-valuenow={active} aria-label={t("students")}>
                  <div className={`h-full ${active >= e.maxStudents ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, (active / e.maxStudents) * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`until.${e.state}`)}</dt>
              <dd className="mt-1 font-semibold">{e.until ? formatDateOnly(e.until, fmt) : t("noEnd")}</dd>
            </div>
            {isAdmin ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("monthly")}</dt>
                <dd className="mt-1 font-semibold">{money(monthlyChargeMinor(current, active))}</dd>
                <p className="text-xs text-muted-foreground">{t("perStudent", { price: money(current.priceMinor) })}</p>
              </div>
            ) : null}
          </dl>
          <ModuleList modules={current.modules} label={t("included")} tm={tm} />
        </CardContent>
      </Card>

      {isAdmin ? (
        <section aria-labelledby="plans" className="space-y-3">
          <h2 id="plans" className="text-lg font-semibold">
            {t("comparePlans")}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {plans
              .filter((p) => p.isPublic)
              .map((p) => (
                <Card key={p.code} className={p.code === e.plan ? "border-primary" : undefined}>
                  <CardHeader className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      {p.code === e.plan ? <Badge>{t("current")}</Badge> : null}
                    </div>
                    <p className="text-2xl font-bold">{money(p.priceMinor)}</p>
                    <p className="text-xs text-muted-foreground">{t("perStudentMonth")}</p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>{p.maxStudents === null ? t("noLimit") : t("upTo", { max: formatNumber(p.maxStudents, fmt) })}</p>
                    <p className="text-muted-foreground">{t("estimate", { amount: money(monthlyChargeMinor(p, active)), count: formatNumber(active, fmt) })}</p>
                    <ModuleList modules={p.modules} tm={tm} />
                  </CardContent>
                </Card>
              ))}
          </div>
          <p className="text-sm text-muted-foreground">{t("howToChange")}</p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("askAdmin")}</p>
      )}
    </div>
  );
}

function ModuleList({ modules, label, tm }: { modules: readonly Module[]; label?: string; tm: (k: Module) => string }) {
  const has = new Set(modules);
  return (
    <div>
      {label ? <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p> : null}
      <ul className="grid gap-1 sm:grid-cols-2">
        {MODULES.map((m) => (
          <li key={m} className={`flex items-center gap-2 text-sm ${has.has(m) ? "" : "text-muted-foreground line-through"}`}>
            {has.has(m) ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Minus className="h-4 w-4" aria-hidden="true" />}
            <span>{tm(m)}</span>
            <span className="sr-only">{has.has(m) ? "" : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
