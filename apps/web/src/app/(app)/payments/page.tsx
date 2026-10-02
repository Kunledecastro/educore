import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ExportMenu } from "@/components/list/export-menu";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { ParamSelect } from "@/components/list/param-select";
import { SortableHeader } from "@/components/list/sortable-header";
import { PageHeader } from "@/components/page-header";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatMoney, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import type { SearchParamsInput } from "@/lib/list-params";
import { PAYMENT_METHOD_FILTERS, PAYMENT_PERIODS, paymentListQuery } from "@/lib/payment-list";
import { getSettingsForUser } from "@/lib/tenant";
import { UploadCard } from "../imports/upload-form";

/**
 * Payments (milestone 3.2): every payment and reversal, newest first, with
 * the period's total; bank-statement import for finance staff.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user, db, isPlatformAdmin } = await requirePermission("payment", "read");
  if (isPlatformAdmin) redirect("/dashboard");
  if (user.role === "PARENT" || user.role === "STUDENT") redirect("/fees");
  const [t, tl, settings] = await Promise.all([getTranslations("payments"), getTranslations("list"), getSettingsForUser(user.tenantId ?? null)]);
  const today = todayInTimeZone(settings.timezone);
  const { params, where, orderBy, period } = paymentListQuery(searchParams, today);
  const [sum, total, payments, any] = await Promise.all([
    db.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.take,
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        invoice: { select: { id: true, invoiceNo: true } },
        recordedBy: { select: { name: true } },
        reverses: { select: { receiptNo: true } },
        reversedBy: { select: { id: true } },
      },
    }),
    db.payment.count(),
  ]);
  const money = (minor: number) => formatMoney(minor / 100, settings);
  const m = (v: { toString(): string } | null) => (v ? (toMinor(v) ?? 0) : 0);
  const canImport = can(user.role, "payment", "import");
  const signed = (minor: number) => (minor < 0 ? `−${money(-minor)}` : money(minor));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={any > 0 && can(user.role, "payment", "export") ? <ExportMenu kind="payments" /> : null} />

      {canImport ? (
        <div className="max-w-xl">
          <UploadCard kind="PAYMENTS" needsYear={false} years={[]} defaultYearId={null} />
        </div>
      ) : null}

      {any === 0 ? (
        <EmptyState
          icon={<Wallet className="h-6 w-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Link href="/fees" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t("goToInvoices")}
            </Link>
          }
        />
      ) : (
        <section aria-labelledby="payments-list" className="space-y-3">
          <h2 id="payments-list" className="sr-only">
            {t("title")}
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ParamSelect param="period" label={t("period")} options={PAYMENT_PERIODS.map((p) => ({ value: p, label: t(`periods.${p}`) }))} selected={period} />
            <p className="text-sm">
              {t("periodTotal", { count: sum._count._all })} <span className="font-semibold tabular-nums">{signed(m(sum._sum.amount))}</span>
            </p>
          </div>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            <ListFilter name="method" label={t("methodFilter")} options={PAYMENT_METHOD_FILTERS.map((x) => ({ value: x, label: t(`methods.${x}`) }))} />
            <ListFilter name="kind" label={t("kindFilter")} options={[{ value: "PAYMENT", label: t("kinds.PAYMENT") }, { value: "REVERSAL", label: t("kinds.REVERSAL") }]} />
          </ListToolbar>
          {payments.length === 0 ? (
            <EmptyState icon={<Wallet className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="paidAt" label={t("date")} defaultSort="paidAt" defaultDir="desc" />
                    <SortableHeader column="receiptNo" label={t("receipt")} defaultSort="paidAt" defaultDir="desc" />
                    <TableHead>{t("student")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("method")}</TableHead>
                    <SortableHeader column="amount" label={t("amount")} defaultSort="paidAt" defaultDir="desc" className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id} className={p.reversedBy ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        {formatDateOnly(p.paidAt, settings)}
                        <div className="text-xs text-muted-foreground">{p.recordedBy?.name ?? t("system")}</div>
                      </TableCell>
                      <TableCell>
                        {p.kind === "REVERSAL" ? (
                          <span className="text-sm">{t("reversalOf", { receipt: p.reverses?.receiptNo ?? "" })}</span>
                        ) : (
                          <span className="font-mono text-xs">
                            {p.receiptNo}
                            {p.reversedBy ? <span className="ml-2 font-sans">{t("reversed")}</span> : null}
                          </span>
                        )}
                        <div>
                          <Link href={`/fees/invoices/${p.invoice.id}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                            {p.invoice.invoiceNo}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {p.student.lastName}, {p.student.firstName}
                        </span>
                        <div className="text-xs text-muted-foreground">{p.student.admissionNo}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {t(`methods.${p.method}`)}
                        {p.reference && p.kind === "PAYMENT" ? <div className="text-xs text-muted-foreground">{p.reference}</div> : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{signed(m(p.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
        </section>
      )}
    </div>
  );
}
