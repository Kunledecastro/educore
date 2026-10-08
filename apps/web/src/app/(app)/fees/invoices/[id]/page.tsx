import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { buttonVariants } from "@educore/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatDateTime, formatMoney, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { displayStatus, type StoredInvoiceStatus } from "@/lib/invoicing";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema, toDateInput } from "@/lib/validation/common";
import { InvoiceStatusBadge } from "../../status-badge";
import { OnlineBanner } from "@/components/fees/online-banner";
import { PayOnlineButton } from "@/components/fees/pay-online-button";
import { getEntitlements } from "@/lib/entitlements-server";
import { PAYSTACK_CURRENCIES, paystack } from "@/lib/payments/paystack";
import { Role } from "@educore/db";
import { AdjustmentButton, CancelInvoiceButton, RecordPaymentButton, ReversePaymentButton } from "./invoice-ui";
import { PendingApprovals } from "@/components/approvals/pending-banner";
import { pendingFor } from "@/lib/approvals/engine";

/** One invoice (3.1/3.2): lines, totals, payments and receipts, and what can be done next. */
export default async function InvoicePage({ params, searchParams }: { params: { id: string }; searchParams: { online?: string | string[] } }) {
  const ctx = await requirePermission("invoice", "read", { page: true });
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const { user, db } = ctx;
  const onlineInPlan = user.tenantId ? (await getEntitlements(user.tenantId)).modules.has("onlinePayments") : false;
  const scope = await studentScopeFor(ctx);
  const invoice = await db.invoice.findFirst({
    where: { id: id.data, student: scope },
    include: {
      term: { select: { name: true } },
      academicYear: { select: { name: true } },
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } } },
      lines: { orderBy: { position: "asc" } },
      payments: {
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        include: { recordedBy: { select: { name: true } }, reversedBy: { select: { id: true } }, reverses: { select: { receiptNo: true } } },
      },
      createdBy: { select: { name: true } },
    },
  });
  if (!invoice) notFound();
  const [t, settings] = await Promise.all([getTranslations("fees.invoice"), getSettingsForUser(user.tenantId ?? null)]);
  const today = todayInTimeZone(settings.timezone);
  const m = (v: { toString(): string }) => toMinor(v) ?? 0;
  const money = (minor: number) => formatMoney(minor / 100, settings);
  const total = m(invoice.totalDue);
  const paid = m(invoice.amountPaid);
  const balance = invoice.status === "CANCELLED" ? 0 : total - paid;
  const status = displayStatus({ status: invoice.status as StoredInvoiceStatus, dueDate: invoice.dueDate }, today);
  const cancelled = invoice.status === "CANCELLED";
  const signed = (minor: number) => (minor < 0 ? `−${money(-minor)}` : money(minor));
  const name = `${invoice.student.firstName} ${invoice.student.lastName}`;
  const isStaff = can(user.role, "feeStructure", "read");
  // Phase 8: a cancellation or reversal waiting for approval.
  const [pendingCancel, pendingReversals] = isStaff && user.tenantId
    ? await Promise.all([pendingFor(user.tenantId, "INVOICE_CANCEL", [invoice.id]), pendingFor(user.tenantId, "PAYMENT_REVERSAL", invoice.payments.map((p) => p.id))])
    : [new Map<string, string>(), new Map<string, string>()];
  const ta = await getTranslations("approvals.pending");
  const pendingItems = [
    ...[...pendingCancel.values()].map((rid) => ({ id: rid, label: ta("invoiceCancel") })),
    ...invoice.payments.filter((p) => pendingReversals.has(p.id)).map((p) => ({ id: pendingReversals.get(p.id)!, label: ta("paymentReversal", { receipt: p.receiptNo ?? "" }) })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href={isStaff ? `/fees?term=${invoice.termId ?? ""}` : "/fees"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
      </div>
      <PendingApprovals items={pendingItems} />
      <PageHeader
        title={t("title", { number: invoice.invoiceNo })}
        description={`${name} · ${invoice.student.admissionNo}${invoice.student.class ? ` · ${invoice.student.class.name}${invoice.student.section ? ` ${invoice.student.section.name}` : ""}` : ""}`}
        actions={
          <>
            <a href={`/api/invoices/${invoice.id}`} className={buttonVariants({ variant: "outline" })}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("downloadPdf")}
            </a>
            {!cancelled && balance > 0 && user.role === Role.PARENT && onlineInPlan && paystack.configured() && PAYSTACK_CURRENCIES.has(invoice.currency) ? (
              <PayOnlineButton invoiceId={invoice.id} invoiceNo={invoice.invoiceNo} balance={(balance / 100).toFixed(2)} balanceLabel={money(balance)} />
            ) : null}
            {!cancelled && balance > 0 && can(user.role, "payment", "create") && isStaff ? (
              <RecordPaymentButton invoiceId={invoice.id} invoiceNo={invoice.invoiceNo} balance={(balance / 100).toFixed(2)} balanceLabel={money(balance)} today={toDateInput(today)} />
            ) : null}
          </>
        }
      />

      <OnlineBanner outcome={Array.isArray(searchParams.online) ? searchParams.online[0] : searchParams.online} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd className="mt-1">
            <InvoiceStatusBadge status={status} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("term")}</dt>
          <dd className="mt-1 font-medium">{invoice.term ? `${invoice.term.name} · ${invoice.academicYear.name}` : invoice.academicYear.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("issued")}</dt>
          <dd className="mt-1 font-medium">{formatDateOnly(invoice.issueDate, settings)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("due")}</dt>
          <dd className="mt-1 font-medium">{formatDateOnly(invoice.dueDate, settings)}</dd>
        </div>
      </dl>

      {cancelled ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {t("cancelledNote", { when: invoice.cancelledAt ? formatDateTime(invoice.cancelledAt, settings) : "", reason: invoice.cancelReason ?? "" })}
        </p>
      ) : null}

      <section aria-labelledby="lines-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-heading" className="text-lg font-semibold">
            {t("linesTitle")}
          </h2>
          {isStaff && !cancelled && can(user.role, "invoice", "update") ? (
            <div className="flex flex-wrap gap-2">
              <AdjustmentButton invoiceId={invoice.id} />
              {paid === 0 ? <CancelInvoiceButton invoiceId={invoice.id} invoiceNo={invoice.invoiceNo} /> : null}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("item")}</TableHead>
                <TableHead className="text-right">{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className={l.kind === "FEE" ? undefined : "text-muted-foreground"}>
                    {l.kind === "DISCOUNT" ? t("discountLine", { name: l.description }) : l.kind === "ADJUSTMENT" ? t("adjustmentLine", { name: l.description }) : l.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{signed(m(l.amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(total)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("paid")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(paid)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">{t("balance")}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(balance)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>

      <section aria-labelledby="payments-heading" className="space-y-2">
        <h2 id="payments-heading" className="text-lg font-semibold">
          {t("paymentsTitle")}
        </h2>
        {invoice.payments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <Receipt className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
            {t("noPayments")}
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead>{t("receipt")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("method")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.payments.map((p) => {
                  const reversed = p.reversedBy !== null;
                  return (
                    <TableRow key={p.id} className={reversed ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        {formatDateOnly(p.paidAt, settings)}
                        <div className="text-xs text-muted-foreground">{p.recordedBy ? t("recordedBy", { name: p.recordedBy.name }) : t("recordedBySystem")}</div>
                      </TableCell>
                      <TableCell>
                        {p.kind === "REVERSAL" ? (
                          <span>
                            {t("reversalOf", { receipt: p.reverses?.receiptNo ?? "" })}
                            {p.note ? <span className="block text-xs text-muted-foreground">{p.note}</span> : null}
                          </span>
                        ) : (
                          <span className="font-mono text-xs">
                            {p.receiptNo}
                            {reversed ? <span className="ml-2 font-sans">{t("reversed")}</span> : null}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {t(`methods.${p.method}`)}
                        {p.reference && p.kind === "PAYMENT" ? <div className="text-xs text-muted-foreground">{p.reference}</div> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{signed(m(p.amount))}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {p.kind === "PAYMENT" && can(user.role, "payment", "read") ? (
                            <a href={`/api/receipts/${p.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={t("downloadReceiptLabel", { receipt: p.receiptNo ?? "" })}>
                              <Download className="h-4 w-4" aria-hidden="true" />
                              <span className="hidden md:inline">{t("receiptPdf")}</span>
                            </a>
                          ) : null}
                          {p.kind === "PAYMENT" && !reversed && isStaff && can(user.role, "payment", "update") ? (
                            <ReversePaymentButton paymentId={p.id} receiptNo={p.receiptNo ?? ""} amount={money(m(p.amount))} />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        {t("createdBy", { name: invoice.createdBy?.name ?? t("system"), when: formatDateTime(invoice.createdAt, settings) })}
      </p>
    </div>
  );
}
