import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, FileText, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { FamilyFees } from "@/components/fees/family-fees";
import { ExportMenu } from "@/components/list/export-menu";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { ParamSelect } from "@/components/list/param-select";
import { SortableHeader } from "@/components/list/sortable-header";
import { FeeTotals } from "@/components/fees/fee-totals";
import { INVOICE_STATUS_FILTERS, feeTotals } from "@/lib/fee-summary";
import { feeTerms } from "@/lib/fees-data";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatMoney, todayInTimeZone } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { invoiceListQuery } from "@/lib/invoice-list";
import { displayStatus, type StoredInvoiceStatus } from "@/lib/invoicing";
import type { SearchParamsInput } from "@/lib/list-params";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser } from "@/lib/tenant";
import { InvoiceStatusBadge } from "./status-badge";

/** Invoices for a term (milestone 3.1): totals, then a searchable, filterable list. */
export default async function InvoicesPage({ searchParams }: { searchParams: SearchParamsInput & { term?: string | string[]; online?: string | string[] } }) {
  const ctx = await requireUser();
  // Families: their children's fees and online payment (3.3).
  if (!can(ctx.user.role, "feeStructure", "read")) {
    if (!can(ctx.user.role, "invoice", "read") || ctx.isPlatformAdmin) redirect("/dashboard");
    return <FamilyFees ctx={ctx} online={Array.isArray(searchParams.online) ? searchParams.online[0] : searchParams.online} />;
  }
  const { user, db } = ctx;
  const [t, tl, settings] = await Promise.all([getTranslations("fees.invoices"), getTranslations("list"), getSettingsForUser(user.tenantId ?? null)]);
  const requested = Array.isArray(searchParams.term) ? searchParams.term[0] : searchParams.term;
  const { terms, selected: term } = await feeTerms(db, settings.timezone, requested);
  if (!term) return <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsDescription")} />;

  const today = todayInTimeZone(settings.timezone);
  const scope = await studentScopeFor(ctx);
  const { params, where, orderBy, classes } = await invoiceListQuery(db, searchParams, { termId: term.id, academicYearId: term.academicYearId, today, scope });
  const [totals, total, invoices] = await Promise.all([
    feeTotals(db, { termId: term.id }, today),
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.take,
      select: {
        id: true, invoiceNo: true, status: true, dueDate: true, totalDue: true, amountPaid: true,
        student: { select: { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } } },
      },
    }),
  ]);
  const canBill = can(user.role, "invoice", "create");
  const money = (minor: number) => formatMoney(minor / 100, settings);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
        <div className="flex flex-wrap gap-2">
          {totals.count > 0 && can(user.role, "invoice", "export") ? <ExportMenu kind="invoices" /> : null}
          {canBill ? (
            <Link href={`/fees/billing?term=${term.id}`} className={buttonVariants()}>
              <Receipt className="h-4 w-4" aria-hidden="true" />
              {t("billTerm")}
            </Link>
          ) : null}
        </div>
      </div>

      {totals.count === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={t("emptyTitle", { term: term.name })}
          description={t("emptyDescription")}
          action={
            canBill ? (
              <Link href={`/fees/billing?term=${term.id}`} className={buttonVariants()}>
                {t("billTerm")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <FeeTotals totals={totals} settings={settings} />
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            <ListFilter name="classId" label={t("classFilter")} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <ListFilter name="status" label={t("statusFilter")} options={INVOICE_STATUS_FILTERS.map((s) => ({ value: s, label: t(`statusFilters.${s}`) }))} />
          </ListToolbar>
          {invoices.length === 0 ? (
            <EmptyState icon={<FileText className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="invoiceNo" label={t("invoiceNo")} defaultSort="invoiceNo" defaultDir="desc" />
                    <SortableHeader column="student" label={t("student")} defaultSort="invoiceNo" defaultDir="desc" />
                    <SortableHeader column="dueDate" label={t("dueDate")} defaultSort="invoiceNo" defaultDir="desc" className="hidden md:table-cell" />
                    <SortableHeader column="total" label={t("total")} defaultSort="invoiceNo" defaultDir="desc" className="hidden text-right sm:table-cell" />
                    <TableHead className="text-right">{t("balance")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const totalMinor = toMinor(inv.totalDue) ?? 0;
                    const balance = inv.status === "CANCELLED" ? 0 : totalMinor - (toMinor(inv.amountPaid) ?? 0);
                    const shown = displayStatus({ status: inv.status as StoredInvoiceStatus, dueDate: inv.dueDate }, today);
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <Link href={`/fees/invoices/${inv.id}`} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
                            {inv.invoiceNo}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {inv.student.lastName}, {inv.student.firstName}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {inv.student.admissionNo}
                            {inv.student.class ? ` · ${inv.student.class.name}${inv.student.section ? ` ${inv.student.section.name}` : ""}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{formatDateOnly(inv.dueDate, settings)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(totalMinor)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(balance)}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={shown} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
        </>
      )}
    </div>
  );
}
