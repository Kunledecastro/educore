import Link from "next/link";
import { Download, Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { InvoiceStatusBadge } from "@/app/(app)/fees/status-badge";
import { PageHeader } from "@/components/page-header";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatMoney, todayInTimeZone } from "@/lib/format";
import type { RequestContext } from "@/lib/guard";
import { displayStatus, type StoredInvoiceStatus } from "@/lib/invoicing";
import { PAYSTACK_CURRENCIES, paystack } from "@/lib/payments/paystack";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser } from "@/lib/tenant";
import { OnlineBanner } from "./online-banner";
import { PayOnlineButton } from "./pay-online-button";

/**
 * Fees for families (milestone 3.3): each child's invoices, balances and
 * receipts; parents can pay online. Everything goes through the student row
 * scope — a parent only ever sees their own children.
 */
export async function FamilyFees({ ctx, online }: { ctx: RequestContext; online?: string }) {
  const { user, db } = ctx;
  const [t, settings] = await Promise.all([getTranslations("fees.family"), getSettingsForUser(user.tenantId ?? null)]);
  const today = todayInTimeZone(settings.timezone);
  const scope = await studentScopeFor(ctx);
  const children = await db.student.findMany({
    where: { AND: [scope, { invoices: { some: {} } }] },
    orderBy: { firstName: "asc" },
    select: {
      id: true, firstName: true, lastName: true,
      class: { select: { name: true } }, section: { select: { name: true } },
      invoices: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { issueDate: "desc" },
        take: 12,
        select: { id: true, invoiceNo: true, status: true, dueDate: true, totalDue: true, amountPaid: true, currency: true, term: { select: { name: true } } },
      },
      payments: {
        where: { kind: "PAYMENT" },
        orderBy: { paidAt: "desc" },
        take: 5,
        select: { id: true, receiptNo: true, paidAt: true, amount: true, method: true, reversedBy: { select: { id: true } } },
      },
    },
  });
  const m = (v: { toString(): string }) => toMinor(v) ?? 0;
  const money = (minor: number) => formatMoney(minor / 100, settings);
  const canPay = user.role === Role.PARENT && paystack.configured() && can(user.role, "payment", "create");
  const canReceipts = can(user.role, "payment", "read");
  const tm = await getTranslations("fees.invoice.methods");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={user.role === Role.PARENT ? t("descriptionParent") : t("descriptionStudent")} />
      <OnlineBanner outcome={online} />
      {children.length === 0 ? (
        <EmptyState icon={<Wallet className="h-6 w-6" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        children.map((child) => {
          const owed = child.invoices.reduce((n, i) => n + m(i.totalDue) - m(i.amountPaid), 0);
          return (
            <Card key={child.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle>
                    {child.firstName} {child.lastName}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{child.class ? `${child.class.name}${child.section ? ` ${child.section.name}` : ""}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("owed")}</p>
                  <p className="text-xl font-semibold tabular-nums">{money(owed)}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="divide-y rounded-lg border">
                  {child.invoices.map((inv) => {
                    const balance = m(inv.totalDue) - m(inv.amountPaid);
                    const status = displayStatus({ status: inv.status as StoredInvoiceStatus, dueDate: inv.dueDate }, today);
                    return (
                      <li key={inv.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Link href={`/fees/invoices/${inv.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                            {inv.term?.name ?? inv.invoiceNo}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {inv.invoiceNo} · {t("due", { date: formatDateOnly(inv.dueDate, settings) })}
                          </p>
                          <p className="mt-1 text-sm">
                            {t("summary", { total: money(m(inv.totalDue)), paid: money(m(inv.amountPaid)) })}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <InvoiceStatusBadge status={status} />
                          <span className="font-semibold tabular-nums">{money(balance)}</span>
                          <a href={`/api/invoices/${inv.id}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={t("downloadInvoice", { number: inv.invoiceNo })}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            PDF
                          </a>
                          {canPay && balance > 0 && PAYSTACK_CURRENCIES.has(inv.currency) ? (
                            <PayOnlineButton invoiceId={inv.id} invoiceNo={inv.invoiceNo} balance={(balance / 100).toFixed(2)} balanceLabel={money(balance)} size="sm" />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {canReceipts && child.payments.length ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">{t("recentPayments")}</h3>
                    <ul className="space-y-1 text-sm">
                      {child.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className={p.reversedBy ? "text-muted-foreground line-through" : undefined}>
                            {formatDateOnly(p.paidAt, settings)} · {tm(p.method)} · <span className="tabular-nums">{money(m(p.amount))}</span>
                          </span>
                          <a href={`/api/receipts/${p.id}`} className="text-primary underline-offset-4 hover:underline">
                            {t("receipt", { number: p.receiptNo ?? "" })}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
      {user.role === Role.PARENT && !paystack.configured() ? <p className="text-sm text-muted-foreground">{t("payAtBursary")}</p> : null}
    </div>
  );
}
