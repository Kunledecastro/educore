import Link from "next/link";
import { BarChart3, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { FeeTotals } from "@/components/fees/fee-totals";
import { ExportMenu } from "@/components/list/export-menu";
import { ParamSelect } from "@/components/list/param-select";
import { feeTotals } from "@/lib/fee-summary";
import { feeTerms } from "@/lib/fees-data";
import { toMinor } from "@/lib/fees";
import { formatMoney, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { DailyCollections } from "./daily-collections";

/**
 * Fee reports for a term (milestone 3.3): totals, by class, by payment
 * method, money in over the last 30 days, and who owes the most.
 */
export default async function FeeReportsPage({ searchParams }: { searchParams: { term?: string | string[] } }) {
  const { user, db } = await requirePermission("invoice", "export", { page: true });
  const [t, tm, settings] = await Promise.all([getTranslations("fees.reports"), getTranslations("fees.invoice.methods"), getSettingsForUser(user.tenantId ?? null)]);
  const requested = Array.isArray(searchParams.term) ? searchParams.term[0] : searchParams.term;
  const { terms, selected: term } = await feeTerms(db, settings.timezone, requested);
  if (!term) return <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsDescription")} />;

  const today = todayInTimeZone(settings.timezone);
  const from = new Date(today.getTime() - 29 * 86_400_000);
  const m = (v: { toString(): string } | null | undefined) => (v ? (toMinor(v) ?? 0) : 0);
  const money = (minor: number) => formatMoney(minor / 100, settings);
  const pct = (r: number | null) => (r === null ? "—" : new Intl.NumberFormat(settings.locale, { style: "percent", maximumFractionDigits: 0 }).format(r));

  const [totals, classes, invoices, byMethod, daily, debtors] = await Promise.all([
    feeTotals(db, { termId: term.id }, today),
    db.classGrade.findMany({ where: { academicYearId: term.academicYearId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.invoice.findMany({ where: { termId: term.id, status: { not: "CANCELLED" } }, select: { totalDue: true, amountPaid: true, student: { select: { classId: true } } } }),
    db.payment.groupBy({ by: ["method"], where: { invoice: { termId: term.id } }, _sum: { amount: true }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["paidAt"], where: { paidAt: { gte: from, lte: today } }, _sum: { amount: true } }),
    db.invoice.findMany({
      where: { termId: term.id, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      select: { id: true, invoiceNo: true, totalDue: true, amountPaid: true, dueDate: true, student: { select: { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } } } } },
    }),
  ]);

  if (totals.count === 0) {
    return (
      <div className="space-y-4">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={t("emptyTitle", { term: term.name })} description={t("emptyDescription")} />
      </div>
    );
  }

  const perClass = classes
    .map((c) => {
      const rows = invoices.filter((i) => i.student.classId === c.id);
      const billed = rows.reduce((n, i) => n + m(i.totalDue), 0);
      const paid = rows.reduce((n, i) => n + m(i.amountPaid), 0);
      return { ...c, count: rows.length, billed, paid, outstanding: billed - paid, rate: billed ? paid / billed : null };
    })
    .filter((c) => c.count > 0);

  // Daily collections (all terms — it's money in), net of reversals, one bar per day.
  const byDay = new Map(daily.map((d) => [d.paidAt.toISOString().slice(0, 10), m(d._sum.amount)]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(from.getTime() + i * 86_400_000);
    return { date: d.toISOString().slice(0, 10), amount: byDay.get(d.toISOString().slice(0, 10)) ?? 0 };
  });

  const topDebtors = debtors
    .map((d) => ({ ...d, balance: m(d.totalDue) - m(d.amountPaid) }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 15);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
        <ExportMenu kind="debtors" />
      </div>
      <FeeTotals totals={totals} settings={settings} />

      <section aria-labelledby="by-class" className="space-y-2">
        <h2 id="by-class" className="text-lg font-semibold">
          {t("byClass")}
        </h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("class")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("invoices")}</TableHead>
                <TableHead className="text-right">{t("billed")}</TableHead>
                <TableHead className="text-right">{t("collected")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{t("outstanding")}</TableHead>
                <TableHead className="text-right">{t("rate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perClass.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.paid)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{money(c.outstanding)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(c.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="daily" className="space-y-2">
          <h2 id="daily" className="text-lg font-semibold">
            {t("daily")}
          </h2>
          <DailyCollections days={days.map((d) => ({ ...d, label: money(d.amount) }))} locale={settings.locale} caption={t("dailyCaption")} dateLabel={t("date")} amountLabel={t("amount")} />
        </section>
        <section aria-labelledby="by-method" className="space-y-2">
          <h2 id="by-method" className="text-lg font-semibold">
            {t("byMethod")}
          </h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("method")}</TableHead>
                  <TableHead className="text-right">{t("entries")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMethod.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      {t("noPayments")}
                    </TableCell>
                  </TableRow>
                ) : (
                  byMethod
                    .sort((a, b) => m(b._sum.amount) - m(a._sum.amount))
                    .map((r) => (
                      <TableRow key={r.method}>
                        <TableCell>{tm(r.method)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r._count._all}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(m(r._sum.amount))}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <section aria-labelledby="debtors" className="space-y-2">
        <h2 id="debtors" className="text-lg font-semibold">
          {t("debtors")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("debtorsIntro")}</p>
        {topDebtors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDebtors")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("student")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("invoice")}</TableHead>
                  <TableHead className="text-right">{t("balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDebtors.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <span className="font-medium">
                        {d.student.lastName}, {d.student.firstName}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {d.student.admissionNo}
                        {d.student.class ? ` · ${d.student.class.name}` : ""}
                        {d.dueDate < today ? ` · ${t("overdue")}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Link href={`/fees/invoices/${d.id}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                        {d.invoiceNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(d.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
