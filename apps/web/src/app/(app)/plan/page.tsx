import { redirect } from "next/navigation";
import { Check, CreditCard, Minus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { AutoRenewButton, ChoosePlanButton } from "@/components/plan/billing-buttons";
import { cheapestPlanWith, STATE_VARIANT } from "@/components/plan/display";
import { PLATFORM_FORMAT } from "@/components/platform/display";
import { addMonths, checkoutPeriodStart, monthlyQuote, planAction } from "@/lib/billing/rules";
import { loadBilling } from "@/lib/billing/subscription-billing";
import { MODULES, type Module } from "@/lib/entitlements";
import { countActiveStudents, loadPlans } from "@/lib/entitlements-data";
import { getEntitlements } from "@/lib/entitlements-server";
import { formatDateOnly, formatMoney, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";

const OUTCOMES = ["paid", "pending", "failed", "abandoned", "review", "checking", "unknown"] as const;

/**
 * Plan & billing (4.1 + 4.2): the school's plan and state, students against
 * the limit, what the next charge will be, the saved card, EduCore invoices,
 * and the plans to choose from. Everyone can open it (module pages send them
 * here); prices, billing and choosing are for school admins — and not for
 * EduCore support while signed in as one. EduCore bills in naira.
 */
export default async function PlanPage({ searchParams }: { searchParams: { need?: string; billing?: string } }) {
  const { user, db, impersonation } = await requireUser();
  if (!user.tenantId) redirect("/platform/plans");
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const [e, plans, active, billing, t, tm] = await Promise.all([
    getEntitlements(user.tenantId),
    loadPlans(),
    countActiveStudents(db, user.tenantId),
    isAdmin ? loadBilling(user.tenantId) : Promise.resolve(null),
    getTranslations("plan"),
    getTranslations("plan.modules"),
  ]);
  const fmt = PLATFORM_FORMAT;
  const now = new Date();
  const current = plans.find((p) => p.code === e.plan)!;
  const need = (MODULES as readonly string[]).includes(searchParams.need ?? "") ? (searchParams.need as Module) : null;
  const suggestion = need ? cheapestPlanWith(plans, need) : null;
  const outcome = (OUTCOMES as readonly string[]).includes(searchParams.billing ?? "") ? searchParams.billing! : null;
  const money = (minor: number) => formatMoney(minor / 100, fmt);
  const date = (d: Date | null | undefined) => (d ? formatDateOnly(d, fmt) : "—");

  const sub = billing?.subscription ?? null;
  const pending = sub?.pendingPlan ? plans.find((p) => p.code === sub.pendingPlan) ?? null : null;
  const nextPlan = pending ?? current;
  const autoRenew = Boolean(sub?.hasCard && !sub.cancelAtPeriodEnd && (sub.status === "ACTIVE" || sub.status === "PAST_DUE"));
  const canChoose = isAdmin && !impersonation && e.state !== "suspended";
  const periodStart = checkoutPeriodStart(e, sub?.currentPeriodEnd ?? null, now);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {outcome ? (
        <p role="status" className={`rounded-md border p-4 text-sm ${outcome === "paid" ? "border-success bg-success/10" : "border-warning bg-warning/10"}`}>
          {t(`outcome.${outcome}`)}
        </p>
      ) : null}
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
              <dd className="mt-1 font-semibold">{e.until ? date(e.until) : t("noEnd")}</dd>
            </div>
            {isAdmin ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("monthly")}</dt>
                <dd className="mt-1 font-semibold">{current.priceMinor > 0 ? money(monthlyQuote(current, active).amountMinor) : money(0)}</dd>
                <p className="text-xs text-muted-foreground">{t("perStudent", { price: money(current.priceMinor) })}</p>
              </div>
            ) : null}
          </dl>
          <ModuleList modules={current.modules} label={t("included")} tm={tm} />
        </CardContent>
      </Card>

      {isAdmin && billing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("billing.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {sub?.hasCard ? (
              <div className="flex flex-wrap items-center gap-3">
                <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <span>{t("billing.card", { brand: (sub.cardBrand ?? "card").toUpperCase(), last4: sub.cardLast4 ?? "····", expiry: sub.cardExpiry ?? "—" })}</span>
                {sub.billingEmail ? <span className="text-muted-foreground">{t("billing.receiptsTo", { email: sub.billingEmail })}</span> : null}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("billing.noCard")}</p>
            )}
            {autoRenew && sub?.currentPeriodEnd ? (
              <p>
                {t("billing.nextCharge", {
                  date: date(sub.currentPeriodEnd),
                  amount: money(monthlyQuote(nextPlan, active).amountMinor),
                  plan: nextPlan.name,
                  count: formatNumber(Math.max(1, active), fmt),
                })}
              </p>
            ) : sub?.hasCard && sub.cancelAtPeriodEnd ? (
              <p className="text-warning-foreground">{t("billing.ending", { date: date(sub.currentPeriodEnd) })}</p>
            ) : null}
            {pending ? <p>{t("billing.pendingDowngrade", { plan: pending.name, date: date(sub?.currentPeriodEnd) })}</p> : null}
            {sub?.status === "PAST_DUE" ? (
              <p role="alert" className="rounded-md border border-warning bg-warning/10 p-3">
                {sub.nextChargeAt
                  ? t("billing.failedRetry", { reason: sub.lastChargeError ?? "—", date: date(sub.nextChargeAt) })
                  : t("billing.failedNoRetry", { reason: sub.lastChargeError ?? "—" })}
              </p>
            ) : null}
            {sub?.hasCard && (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && !impersonation ? (
              <AutoRenewButton on={autoRenew} paidUntil={date(sub.currentPeriodEnd)} />
            ) : null}
            {impersonation ? <p className="text-muted-foreground">{t("billing.supportCannotPay")}</p> : null}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("invoices.number")}</TableHead>
                    <TableHead>{t("invoices.period")}</TableHead>
                    <TableHead>{t("invoices.plan")}</TableHead>
                    <TableHead className="text-right">{t("invoices.students")}</TableHead>
                    <TableHead className="text-right">{t("invoices.amount")}</TableHead>
                    <TableHead>{t("invoices.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billing.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        {t("invoices.empty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    billing.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.number}</TableCell>
                        <TableCell className="whitespace-nowrap">{`${date(inv.periodStart)} – ${date(inv.periodEnd)}`}</TableCell>
                        <TableCell>{plans.find((p) => p.code === inv.plan)?.name ?? inv.plan}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(inv.students, fmt)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(inv.amountMinor)}</TableCell>
                        <TableCell>
                          {inv.status === "PAID" ? (
                            <Badge variant="success">{t("invoices.paidOn", { date: date(inv.paidAt) })}</Badge>
                          ) : (
                            <Badge variant="warning">{t(`invoices.payment.${inv.payments[0]?.status ?? "PENDING"}`)}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <section aria-labelledby="plans" className="space-y-3">
          <h2 id="plans" className="text-lg font-semibold">
            {t("comparePlans")}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {plans
              .filter((p) => p.isPublic && p.code !== "FREE_TRIAL")
              .map((p) => {
                const q = monthlyQuote(p, active);
                const action = planAction({ state: e.state, hasCard: Boolean(sub?.hasCard), current, target: p, pendingPlan: sub?.pendingPlan ?? null });
                const overCap = p.maxStudents !== null && active > p.maxStudents;
                const description =
                  action === "checkout"
                    ? t("choose.describe.checkout", { amount: money(q.amountMinor), count: formatNumber(q.students, fmt), from: date(periodStart), to: date(addMonths(periodStart, 1)), plan: p.name })
                    : action === "switchNow"
                      ? t("choose.describe.switchNow", { plan: p.name, amount: money(q.amountMinor), date: date(sub?.currentPeriodEnd) })
                      : action === "scheduleDowngrade"
                        ? `${t("choose.describe.scheduleDowngrade", { plan: p.name, date: date(sub?.currentPeriodEnd), amount: money(q.amountMinor) })}${overCap ? ` ${t("choose.describe.overCap", { max: formatNumber(p.maxStudents!, fmt) })}` : ""}`
                        : t("choose.describe.cancelScheduled", { plan: p.name });
                return (
                  <Card key={p.code} className={p.code === e.plan ? "border-primary" : undefined}>
                    <CardHeader className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{p.name}</CardTitle>
                        {p.code === e.plan ? <Badge>{t("current")}</Badge> : p.code === sub?.pendingPlan ? <Badge variant="secondary">{t("fromRenewal")}</Badge> : null}
                      </div>
                      <p className="text-2xl font-bold">{money(p.priceMinor)}</p>
                      <p className="text-xs text-muted-foreground">{t("perStudentMonth")}</p>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>{p.maxStudents === null ? t("noLimit") : t("upTo", { max: formatNumber(p.maxStudents, fmt) })}</p>
                      <p className="text-muted-foreground">{t("estimate", { amount: money(q.amountMinor), count: formatNumber(active, fmt) })}</p>
                      <ModuleList modules={p.modules} tm={tm} />
                      {canChoose && action !== "none" ? (
                        <ChoosePlanButton plan={p.code as "STARTER" | "STANDARD" | "PREMIUM"} planName={p.name} action={action} description={description} variant={p.code === e.plan ? "default" : "outline"} />
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
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
          </li>
        ))}
      </ul>
    </div>
  );
}
