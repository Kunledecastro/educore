import { PlatformResetTwoFactor, TwoFactorExemptToggle } from "@/components/platform/reset-two-factor";
import { parseTenantSettings } from "@/lib/tenant-settings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { forTenant, platformPrisma } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { PLATFORM_FORMAT, STATUS_VARIANT } from "@/components/platform/display";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { loadOnboardingChecklist } from "@/lib/onboarding-data";
import { trialDaysLeft, usageFor } from "@/lib/platform-data";
import { idSchema } from "@/lib/validation/common";
import { STATE_VARIANT } from "@/components/plan/display";
import { loadEntitlements } from "@/lib/entitlements-data";
import { loadBilling } from "@/lib/billing/subscription-billing";
import { ChangePlanButton, ImpersonateButton, ReactivateButton, SuspendButton } from "./tenant-actions";

/** One school, for the platform team (Phase 4.0): usage, setup progress, admins, activity, support sessions. */
export default async function PlatformTenantPage({ params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const db = platformPrisma();
  const tenant = await db.tenant.findUnique({ where: { id: id.data }, include: { subscription: true } });
  if (!tenant) notFound();
  const t = await getTranslations("platform");
  const fmt = PLATFORM_FORMAT;

  const [usage, admins, activity, sessions, money] = await Promise.all([
    usageFor([tenant.id]).then((m) => m.get(tenant.id)!),
    db.user.findMany({ where: { tenantId: tenant.id, role: "SCHOOL_ADMIN" }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, isActive: true, passwordHash: true, twoFactorEnabled: true } }),
    db.auditLog.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } } } }),
    db.impersonationSession.findMany({ where: { tenantId: tenant.id }, orderBy: { startedAt: "desc" }, take: 10, include: { platformAdmin: { select: { name: true } }, targetUser: { select: { name: true } } } }),
    db.payment.aggregate({ where: { tenantId: tenant.id }, _sum: { amount: true } }),
  ]);
  const firstAdmin = admins.find((a) => a.isActive);
  const checklist = firstAdmin ? await loadOnboardingChecklist(forTenant(tenant.id), firstAdmin.id) : null;
  const days = trialDaysLeft(tenant);
  const [entitlements, billing, toReview] = await Promise.all([
    loadEntitlements(tenant.id),
    loadBilling(tenant.id),
    db.platformPayment.findMany({ where: { tenantId: tenant.id, status: "NEEDS_REVIEW" }, orderBy: { createdAt: "desc" }, include: { invoice: { select: { number: true } } } }),
  ]);
  const tb = await getTranslations("platform.billing");
  const tPlan = await getTranslations("plan");
  const tOn = await getTranslations("onboarding.steps");

  return (
    <div className="space-y-6">
      <Link href="/platform/tenants" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("tenant.back")}
      </Link>
      <PageHeader
        title={tenant.name}
        description={`${tenant.slug} · ${t("tenant.joined", { date: formatDateOnly(tenant.createdAt, fmt) })}`}
        actions={tenant.status === "ACTIVE" ? <SuspendButton tenantId={tenant.id} name={tenant.name} /> : <ReactivateButton tenantId={tenant.id} name={tenant.name} />}
      />
      {tenant.status !== "ACTIVE" ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {t("tenant.suspendedNote", { when: tenant.suspendedAt ? formatDateTime(tenant.suspendedAt, fmt) : "—", reason: tenant.suspendedReason ?? "—" })}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          [t("tenant.status"), <Badge key="s" variant={STATUS_VARIANT[tenant.status]}>{t(`statuses.${tenant.status}`)}</Badge>],
          [
            t("tenant.plan"),
            <div key="p" className="space-y-1">
              <p>{`${t(`plans.${tenant.plan}`)}${days !== null ? ` · ${days < 0 ? t("tenants.trialOver") : t("tenants.trialLeft", { days })}` : ""}`}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
                <Badge variant={STATE_VARIANT[entitlements.state]}>{tPlan(`states.${entitlements.state}`)}</Badge>
                {entitlements.until ? `${tPlan(`until.${entitlements.state}`)}: ${formatDateOnly(entitlements.until, fmt)}` : null}
              </p>
              <ChangePlanButton tenantId={tenant.id} plan={tenant.plan} until={tenant.subscription?.currentPeriodEnd ? tenant.subscription.currentPeriodEnd.toISOString().slice(0, 10) : ""} />
            </div>,
          ],
          [t("tenants.students"), formatNumber(usage.students, fmt)],
          [t("tenant.staffParents"), `${formatNumber(usage.staff, fmt)} / ${formatNumber(usage.parents, fmt)}`],
          [t("tenant.feesCollected"), formatMoney((toMinor(money._sum.amount ?? 0) ?? 0) / 100, fmt)],
        ].map(([label, value], i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("tenant.admins")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("tenant.adminsHint")}</p>
            <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
              <span className={parseTenantSettings(tenant.settings).platformFlags.twoFactorExempt ? "text-warning" : "text-muted-foreground"}>
                {parseTenantSettings(tenant.settings).platformFlags.twoFactorExempt ? t("tenant.exemptIsOn") : t("tenant.exemptIsOff")}
              </span>
              <TwoFactorExemptToggle tenantId={tenant.id} exempt={parseTenantSettings(tenant.settings).platformFlags.twoFactorExempt} school={tenant.name} />
            </div>
          </CardHeader>
          <CardContent>
            {admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("tenant.noAdmins")}</p>
            ) : (
              <ul className="divide-y">
                {admins.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-medium">{a.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {a.email}
                        {!a.isActive ? ` · ${t("tenant.inactive")}` : !a.passwordHash ? ` · ${t("tenant.invited")}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className={`text-xs ${a.twoFactorEnabled ? "text-success" : "text-destructive"}`}>{a.twoFactorEnabled ? t("tenant.twoFactorOn") : t("tenant.twoFactorOff")}</span>
                      {a.twoFactorEnabled ? <PlatformResetTwoFactor userId={a.id} name={a.name} /> : null}
                      {a.isActive && tenant.status === "ACTIVE" ? <ImpersonateButton userId={a.id} name={a.name} school={tenant.name} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("tenant.setup")}</CardTitle>
            <p className="text-sm text-muted-foreground">{checklist ? t("tenant.setupProgress", { done: checklist.doneCount, total: checklist.total }) : t("tenant.noAdmins")}</p>
          </CardHeader>
          <CardContent>
            {checklist ? (
              <ul className="space-y-1 text-sm">
                {checklist.steps.map((s) => (
                  <li key={s.id} className={s.status === "done" ? "text-muted-foreground" : undefined}>
                    <span aria-hidden="true">{s.status === "done" ? "✓ " : "○ "}</span>
                    <span className="sr-only">{s.status === "done" ? t("tenant.stepDone") : t("tenant.stepTodo")}: </span>
                    {tOn(`${s.id}.title` as never)}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tb("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {billing.subscription ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{tb("card")}</dt>
                <dd>{billing.subscription.hasCard ? `${(billing.subscription.cardBrand ?? "card").toUpperCase()} ···· ${billing.subscription.cardLast4 ?? "????"} (${billing.subscription.cardExpiry ?? "—"}) · ${billing.subscription.billingEmail ?? "—"}` : tb("noCard")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{tb("status")}</dt>
                <dd>
                  {`${billing.subscription.status} · ${tb("paidUntil")} ${billing.subscription.currentPeriodEnd ? formatDateOnly(billing.subscription.currentPeriodEnd, fmt) : "—"}`}
                  {billing.subscription.cancelAtPeriodEnd ? ` · ${tb("autoRenewOff")}` : ""}
                  {billing.subscription.pendingPlan ? ` · ${tb("pending", { plan: t(`plans.${billing.subscription.pendingPlan}`) })}` : ""}
                </dd>
              </div>
              {billing.subscription.failedAttempts > 0 ? (
                <div className="sm:col-span-2 text-warning-foreground">
                  {tb("failures", { count: billing.subscription.failedAttempts, reason: billing.subscription.lastChargeError ?? "—", next: billing.subscription.nextChargeAt ? formatDateOnly(billing.subscription.nextChargeAt, fmt) : tb("noRetry") })}
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-muted-foreground">{tb("none")}</p>
          )}
          {toReview.length > 0 ? (
            <div role="alert" className="rounded-md border border-warning bg-warning/10 p-3">
              <p className="font-medium">{tb("review")}</p>
              <ul className="mt-1 list-disc pl-5">
                {toReview.map((p) => (
                  <li key={p.id}>{`${p.reference} · ${p.invoice.number} · ${formatMoney(p.amountMinor / 100, fmt)} · ${p.message ?? ""}`}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {billing.invoices.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {billing.invoices.slice(0, 6).map((inv) => (
                <li key={inv.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span className="font-medium">{inv.number}</span>
                  <span>{`${formatDateOnly(inv.periodStart, fmt)} – ${formatDateOnly(inv.periodEnd, fmt)}`}</span>
                  <span>{`${t(`plans.${inv.plan}`)} · ${formatNumber(inv.students, fmt)}`}</span>
                  <span className="tabular-nums">{formatMoney(inv.amountMinor / 100, fmt)}</span>
                  <Badge variant={inv.status === "PAID" ? "success" : "warning"}>{inv.status === "PAID" ? tb("paid") : tb("open")}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <section aria-labelledby="activity" className="space-y-2">
        <h2 id="activity" className="text-lg font-semibold">
          {t("tenant.activity")}
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tenant.noActivity")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenant.when")}</TableHead>
                  <TableHead>{t("tenant.who")}</TableHead>
                  <TableHead>{t("tenant.what")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(a.createdAt, fmt)}</TableCell>
                    <TableCell className="text-sm">
                      {a.actor?.name ?? t("tenant.system")}
                      {a.impersonatorId ? <Badge variant="warning" className="ml-2">{t("tenant.viaSupport")}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.action.toLowerCase()} · {a.entityType}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="sessions" className="space-y-2">
        <h2 id="sessions" className="text-lg font-semibold">
          {t("tenant.supportSessions")}
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tenant.noSessions")}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="p-3">
                <span className="font-medium">{s.platformAdmin.name}</span> → {s.targetUser.name} · {formatDateTime(s.startedAt, fmt)}
                {s.endedAt ? ` – ${formatDateTime(s.endedAt, fmt)}` : s.expiresAt > new Date() ? ` · ${t("tenant.live")}` : ` · ${t("tenant.expired")}`}
                <div className="text-xs text-muted-foreground">{s.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
